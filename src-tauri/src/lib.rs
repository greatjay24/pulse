use chrono::{Datelike, Timelike};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Integration {
    #[serde(rename = "type")]
    integration_type: String,
    #[serde(rename = "apiKey")]
    api_key: Option<String>,
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    #[serde(rename = "teamId")]
    team_id: Option<String>,
    enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    platform: Option<String>, // Which platform this integration belongs to
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct App {
    id: String,
    name: String,
    #[serde(default)]
    platforms: Vec<String>, // Multi-platform support: web, mobile, service, fun
    integrations: Vec<Integration>,
}

// ==========================================
// Stripe Types
// ==========================================

#[derive(Debug, Serialize, Deserialize)]
struct PlanRevenue {
    #[serde(rename = "planId")]
    plan_id: String,
    #[serde(rename = "planName")]
    plan_name: String,
    mrr: f64,
    #[serde(rename = "subscriberCount")]
    subscriber_count: i32,
    #[serde(rename = "percentOfTotal")]
    percent_of_total: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct MrrBridge {
    #[serde(rename = "newMrr")]
    new_mrr: f64,
    #[serde(rename = "expansionMrr")]
    expansion_mrr: f64,
    #[serde(rename = "contractionMrr")]
    contraction_mrr: f64,
    #[serde(rename = "churnedMrr")]
    churned_mrr: f64,
    #[serde(rename = "reactivationMrr")]
    reactivation_mrr: f64,
    #[serde(rename = "netNewMrr")]
    net_new_mrr: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct DailyRevenue {
    date: String,
    revenue: f64,
}

#[derive(Debug, Serialize, Deserialize)]
struct StripeMetrics {
    mrr: f64,
    arr: f64,
    #[serde(rename = "activeSubscriptions")]
    active_subscriptions: i32,
    #[serde(rename = "revenue30d")]
    revenue_30d: f64,
    #[serde(rename = "churnRate")]
    churn_rate: f64,
    #[serde(rename = "newMrr")]
    new_mrr: f64,
    #[serde(rename = "expansionMrr")]
    expansion_mrr: f64,
    #[serde(rename = "churnedMrr")]
    churned_mrr: f64,
    #[serde(rename = "netNewMrr")]
    net_new_mrr: f64,
    #[serde(rename = "newSubscribers30d")]
    new_subscribers_30d: i32,
    #[serde(rename = "churnedSubscribers30d")]
    churned_subscribers_30d: i32,
    #[serde(rename = "revenueGrowthRate")]
    revenue_growth_rate: f64,
    #[serde(rename = "subscriberGrowthRate")]
    subscriber_growth_rate: f64,
    arpu: f64,
    #[serde(rename = "ltvEstimate")]
    ltv_estimate: f64,
    #[serde(rename = "revenueByPlan")]
    revenue_by_plan: Vec<PlanRevenue>,
    #[serde(rename = "mrrBridge")]
    mrr_bridge: MrrBridge,
    #[serde(rename = "trialConversionRate")]
    trial_conversion_rate: f64,
    #[serde(rename = "averageRevenuePerSubscription")]
    average_revenue_per_subscription: f64,
    #[serde(rename = "dailyRevenue")]
    daily_revenue: Vec<DailyRevenue>,
    #[serde(rename = "dailySubscribers")]
    daily_subscribers: Vec<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StripeEvent {
    id: String,
    #[serde(rename = "type")]
    event_type: String,
    created: i64,
    description: String,
    amount: Option<i64>,
    #[serde(rename = "customerEmail")]
    customer_email: Option<String>,
    #[serde(rename = "planName")]
    plan_name: Option<String>,
    currency: Option<String>,
}

// ==========================================
// Vercel Types
// ==========================================

#[derive(Debug, Serialize, Deserialize)]
struct Deployment {
    id: String,
    name: String,
    state: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct VercelMetrics {
    deployments: Vec<Deployment>,
    #[serde(rename = "lastDeployedAt")]
    last_deployed_at: Option<String>,
    status: String,
}

// ==========================================
// PostHog Types
// ==========================================

#[derive(Debug, Serialize, Deserialize)]
struct PostHogMetrics {
    #[serde(rename = "totalEvents24h")]
    total_events_24h: i64,
    #[serde(rename = "uniqueUsers24h")]
    unique_users_24h: i64,
    #[serde(rename = "totalEvents7d")]
    total_events_7d: i64,
    #[serde(rename = "uniqueUsers7d")]
    unique_users_7d: i64,
}

// ==========================================
// Supabase Types
// ==========================================

#[derive(Debug, Serialize, Deserialize)]
struct SupabaseMetrics {
    #[serde(rename = "totalUsers")]
    total_users: i32,
    #[serde(rename = "newUsers7d")]
    new_users_7d: i32,
    #[serde(rename = "databaseSize")]
    database_size: String,
    #[serde(rename = "apiRequests24h")]
    api_requests_24h: i64,
}

// ==========================================
// Combined App Metrics
// ==========================================

#[derive(Debug, Serialize, Deserialize)]
struct AppMetrics {
    stripe: Option<StripeMetrics>,
    vercel: Option<VercelMetrics>,
    posthog: Option<PostHogMetrics>,
    supabase: Option<SupabaseMetrics>,
    #[serde(rename = "stripeEvents")]
    stripe_events: Option<Vec<StripeEvent>>,
    #[serde(rename = "lastUpdated")]
    last_updated: String,
}

// ==========================================
// Historical Data Types
// ==========================================

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MetricSnapshot {
    date: String,
    #[serde(rename = "appId")]
    app_id: String,
    stripe: Option<StripeSnapshot>,
    vercel: Option<VercelSnapshot>,
    posthog: Option<PostHogSnapshot>,
    supabase: Option<SupabaseSnapshot>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StripeSnapshot {
    mrr: f64,
    #[serde(rename = "activeSubscriptions")]
    active_subscriptions: i32,
    #[serde(rename = "churnRate")]
    churn_rate: f64,
    arr: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct VercelSnapshot {
    deployments: i32,
    #[serde(rename = "successRate")]
    success_rate: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PostHogSnapshot {
    #[serde(rename = "uniqueUsers")]
    unique_users: i64,
    #[serde(rename = "totalEvents")]
    total_events: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SupabaseSnapshot {
    #[serde(rename = "totalUsers")]
    total_users: i32,
    #[serde(rename = "apiRequests")]
    api_requests: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct HistoricalData {
    #[serde(rename = "appId")]
    app_id: String,
    snapshots: Vec<MetricSnapshot>,
    #[serde(rename = "lastUpdated")]
    last_updated: String,
}

// ==========================================
// Settings & Storage
// ==========================================

fn get_pulse_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join(".pulse")
}

fn get_settings_path() -> PathBuf {
    get_pulse_dir().join("settings.json")
}

fn get_history_path(app_id: &str) -> PathBuf {
    get_pulse_dir().join("history").join(format!("{}.json", app_id))
}

fn ensure_settings_dir() {
    let settings_path = get_settings_path();
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).ok();
    }
}

fn ensure_history_dir() {
    let history_dir = get_pulse_dir().join("history");
    fs::create_dir_all(history_dir).ok();
}

#[tauri::command]
fn get_settings() -> String {
    ensure_settings_dir();
    let settings_path = get_settings_path();

    match fs::read_to_string(&settings_path) {
        Ok(content) => content,
        Err(_) => {
            let default = r#"{"apps":[],"refreshInterval":5,"launchAtStartup":false}"#;
            default.to_string()
        }
    }
}

#[tauri::command]
fn save_settings(settings: String) -> Result<(), String> {
    ensure_settings_dir();
    let settings_path = get_settings_path();

    fs::write(&settings_path, settings).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_history(app_id: String) -> String {
    ensure_history_dir();
    let history_path = get_history_path(&app_id);

    match fs::read_to_string(&history_path) {
        Ok(content) => content,
        Err(_) => {
            let default = HistoricalData {
                app_id: app_id.clone(),
                snapshots: vec![],
                last_updated: chrono::Utc::now().to_rfc3339(),
            };
            serde_json::to_string(&default).unwrap_or_else(|_| "{}".to_string())
        }
    }
}

#[tauri::command]
fn save_snapshot(app_id: String, metrics: String) -> Result<(), String> {
    ensure_history_dir();
    let history_path = get_history_path(&app_id);

    // Parse incoming metrics
    let app_metrics: AppMetrics = serde_json::from_str(&metrics).map_err(|e| e.to_string())?;

    // Load existing history
    let mut history: HistoricalData = match fs::read_to_string(&history_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| HistoricalData {
            app_id: app_id.clone(),
            snapshots: vec![],
            last_updated: chrono::Utc::now().to_rfc3339(),
        }),
        Err(_) => HistoricalData {
            app_id: app_id.clone(),
            snapshots: vec![],
            last_updated: chrono::Utc::now().to_rfc3339(),
        },
    };

    // Create today's date string
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    // Check if we already have a snapshot for today
    let existing_index = history.snapshots.iter().position(|s| s.date == today);

    // Create new snapshot
    let snapshot = MetricSnapshot {
        date: today.clone(),
        app_id: app_id.clone(),
        stripe: app_metrics.stripe.as_ref().map(|s| StripeSnapshot {
            mrr: s.mrr,
            active_subscriptions: s.active_subscriptions,
            churn_rate: s.churn_rate,
            arr: s.arr,
        }),
        vercel: app_metrics.vercel.as_ref().map(|v| VercelSnapshot {
            deployments: v.deployments.len() as i32,
            success_rate: 100.0, // Simplified
        }),
        posthog: app_metrics.posthog.as_ref().map(|p| PostHogSnapshot {
            unique_users: p.unique_users_7d,
            total_events: p.total_events_7d,
        }),
        supabase: app_metrics.supabase.as_ref().map(|s| SupabaseSnapshot {
            total_users: s.total_users,
            api_requests: s.api_requests_24h,
        }),
    };

    // Update or append snapshot
    if let Some(index) = existing_index {
        history.snapshots[index] = snapshot;
    } else {
        history.snapshots.push(snapshot);
    }

    // Keep only last 90 days
    if history.snapshots.len() > 90 {
        history.snapshots = history.snapshots.split_off(history.snapshots.len() - 90);
    }

    // Sort by date
    history.snapshots.sort_by(|a, b| a.date.cmp(&b.date));

    history.last_updated = chrono::Utc::now().to_rfc3339();

    // Save
    let json = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
    fs::write(&history_path, json).map_err(|e| e.to_string())
}

// ==========================================
// Fetch App Metrics
// ==========================================

#[tauri::command]
async fn fetch_app_metrics(app: String) -> Result<String, String> {
    let app: App = serde_json::from_str(&app).map_err(|e| e.to_string())?;
    let client = reqwest::Client::new();

    let mut metrics = AppMetrics {
        stripe: None,
        vercel: None,
        posthog: None,
        supabase: None,
        stripe_events: None,
        last_updated: chrono::Utc::now().to_rfc3339(),
    };

    for integration in &app.integrations {
        if !integration.enabled {
            continue;
        }

        match integration.integration_type.as_str() {
            "stripe" => {
                if let Some(api_key) = &integration.api_key {
                    metrics.stripe = fetch_stripe_metrics(&client, api_key).await.ok();
                    metrics.stripe_events = fetch_stripe_events(&client, api_key).await.ok();
                }
            }
            "vercel" => {
                if let (Some(api_key), Some(project_id)) =
                    (&integration.api_key, &integration.project_id)
                {
                    metrics.vercel = fetch_vercel_metrics(
                        &client,
                        api_key,
                        project_id,
                        integration.team_id.as_deref(),
                    ).await.ok();
                }
            }
            "posthog" => {
                if let (Some(api_key), Some(project_id)) =
                    (&integration.api_key, &integration.project_id)
                {
                    metrics.posthog =
                        fetch_posthog_metrics(&client, api_key, project_id).await.ok();
                }
            }
            "supabase" => {
                if let (Some(api_key), Some(project_id)) =
                    (&integration.api_key, &integration.project_id)
                {
                    metrics.supabase =
                        fetch_supabase_metrics(&client, api_key, project_id).await.ok();
                }
            }
            _ => {}
        }
    }

    serde_json::to_string(&metrics).map_err(|e| e.to_string())
}

// ==========================================
// Stripe API Functions
// ==========================================

async fn fetch_stripe_metrics(
    client: &reqwest::Client,
    api_key: &str,
) -> Result<StripeMetrics, String> {
    // First, fetch all products to get their names
    let products_response = client
        .get("https://api.stripe.com/v1/products")
        .query(&[("limit", "100"), ("active", "true")])
        .basic_auth(api_key, None::<&str>)
        .send()
        .await
        .ok();

    let mut product_names: HashMap<String, String> = HashMap::new();
    if let Some(resp) = products_response {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            if let Some(products) = data["data"].as_array() {
                for product in products {
                    if let (Some(id), Some(name)) = (product["id"].as_str(), product["name"].as_str()) {
                        product_names.insert(id.to_string(), name.to_string());
                    }
                }
            }
        }
    }
    println!("Loaded {} product names", product_names.len());

    // Fetch active subscriptions (don't expand too deep - Stripe has 4 level limit)
    let subs_response = client
        .get("https://api.stripe.com/v1/subscriptions")
        .query(&[("status", "active"), ("limit", "100")])
        .basic_auth(api_key, None::<&str>)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let subs_data: serde_json::Value = subs_response.json().await.map_err(|e| e.to_string())?;

    let empty_vec = vec![];
    let subscriptions = subs_data["data"].as_array().unwrap_or(&empty_vec);
    let active_subscriptions = subscriptions.len() as i32;

    println!("Found {} active subscriptions", active_subscriptions);

    // Track revenue by plan
    let mut plan_revenues: HashMap<String, (String, f64, i32)> = HashMap::new();

    // Calculate MRR from subscriptions
    let mrr: f64 = subscriptions
        .iter()
        .filter_map(|sub| {
            // Try price first (newer API), then fall back to plan (older API)
            let item = &sub["items"]["data"][0];
            let price_data = &item["price"];
            let plan_data = &item["plan"];

            // Get amount - try price.unit_amount first, then plan.amount
            let amount = price_data["unit_amount"].as_f64()
                .or_else(|| plan_data["amount"].as_f64())
                .unwrap_or(0.0);

            // Get interval - try price.recurring.interval first, then plan.interval
            let interval = price_data["recurring"]["interval"].as_str()
                .or_else(|| plan_data["interval"].as_str())
                .unwrap_or("month");

            let quantity = item["quantity"].as_f64().unwrap_or(1.0);

            let monthly = match interval {
                "year" => amount * quantity / 12.0,
                "month" => amount * quantity,
                "week" => amount * quantity * 4.33,
                "day" => amount * quantity * 30.0,
                _ => amount * quantity,
            };

            let monthly_dollars = monthly / 100.0;

            // Get product ID and look up the name
            let product_id = price_data["product"].as_str()
                .or_else(|| plan_data["product"].as_str())
                .unwrap_or("unknown");

            let product_name = product_names.get(product_id)
                .cloned()
                .or_else(|| price_data["nickname"].as_str().map(|s| s.to_string()))
                .or_else(|| plan_data["nickname"].as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "Unknown Plan".to_string());

            println!("Subscription: product={}, name={}, amount={}, monthly=${}",
                     product_id, product_name, amount, monthly_dollars);

            // Track by product ID
            let entry = plan_revenues.entry(product_id.to_string()).or_insert((product_name, 0.0, 0));
            entry.1 += monthly_dollars;
            entry.2 += 1;

            Some(monthly_dollars)
        })
        .sum();

    // Build revenue by plan
    let revenue_by_plan: Vec<PlanRevenue> = plan_revenues
        .into_iter()
        .map(|(plan_id, (plan_name, plan_mrr, count))| PlanRevenue {
            plan_id,
            plan_name,
            mrr: plan_mrr,
            subscriber_count: count,
            percent_of_total: if mrr > 0.0 { (plan_mrr / mrr) * 100.0 } else { 0.0 },
        })
        .collect();

    // Fetch canceled subscriptions in last 30 days for churn data
    let thirty_days_ago = chrono::Utc::now() - chrono::Duration::days(30);
    let canceled_response = client
        .get("https://api.stripe.com/v1/subscriptions")
        .query(&[
            ("status", "canceled"),
            ("limit", "100"),
            ("created[gte]", &thirty_days_ago.timestamp().to_string()),
        ])
        .basic_auth(api_key, None::<&str>)
        .send()
        .await
        .ok();

    let mut churned_subscribers_30d = 0;
    let mut churned_mrr = 0.0;

    if let Some(resp) = canceled_response {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            let canceled = data["data"].as_array().unwrap_or(&empty_vec);
            churned_subscribers_30d = canceled.len() as i32;

            churned_mrr = canceled
                .iter()
                .filter_map(|sub| {
                    let item = &sub["items"]["data"][0];
                    let price_data = &item["price"];
                    let plan_data = &item["plan"];

                    let amount = price_data["unit_amount"].as_f64()
                        .or_else(|| plan_data["amount"].as_f64())
                        .unwrap_or(0.0);
                    let interval = price_data["recurring"]["interval"].as_str()
                        .or_else(|| plan_data["interval"].as_str())
                        .unwrap_or("month");
                    let quantity = item["quantity"].as_f64().unwrap_or(1.0);

                    let monthly = match interval {
                        "year" => amount * quantity / 12.0,
                        "month" => amount * quantity,
                        _ => amount * quantity,
                    };

                    Some(monthly / 100.0)
                })
                .sum();
        }
    }

    // Fetch new subscriptions in last 30 days
    let new_subs_response = client
        .get("https://api.stripe.com/v1/subscriptions")
        .query(&[
            ("status", "active"),
            ("limit", "100"),
            ("created[gte]", &thirty_days_ago.timestamp().to_string()),
        ])
        .basic_auth(api_key, None::<&str>)
        .send()
        .await
        .ok();

    let mut new_subscribers_30d = 0;
    let mut new_mrr = 0.0;

    if let Some(resp) = new_subs_response {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            let new_subs = data["data"].as_array().unwrap_or(&empty_vec);
            new_subscribers_30d = new_subs.len() as i32;

            new_mrr = new_subs
                .iter()
                .filter_map(|sub| {
                    let item = &sub["items"]["data"][0];
                    let price_data = &item["price"];
                    let plan_data = &item["plan"];

                    let amount = price_data["unit_amount"].as_f64()
                        .or_else(|| plan_data["amount"].as_f64())
                        .unwrap_or(0.0);
                    let interval = price_data["recurring"]["interval"].as_str()
                        .or_else(|| plan_data["interval"].as_str())
                        .unwrap_or("month");
                    let quantity = item["quantity"].as_f64().unwrap_or(1.0);

                    let monthly = match interval {
                        "year" => amount * quantity / 12.0,
                        "month" => amount * quantity,
                        _ => amount * quantity,
                    };

                    Some(monthly / 100.0)
                })
                .sum();
        }
    }

    // Fetch charges for last 30 days (actual revenue)
    let charges_response = client
        .get("https://api.stripe.com/v1/charges")
        .query(&[
            ("limit", "100"),
            ("created[gte]", &thirty_days_ago.timestamp().to_string()),
        ])
        .basic_auth(api_key, None::<&str>)
        .send()
        .await
        .ok();

    let mut revenue_30d = mrr; // Default to MRR

    if let Some(resp) = charges_response {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            let charges = data["data"].as_array().unwrap_or(&empty_vec);
            revenue_30d = charges
                .iter()
                .filter(|c| c["status"].as_str() == Some("succeeded"))
                .filter_map(|c| c["amount"].as_f64())
                .sum::<f64>()
                / 100.0;
        }
    }

    // Calculate derived metrics
    let arr = mrr * 12.0;
    let arpu = if active_subscriptions > 0 {
        mrr / active_subscriptions as f64
    } else {
        0.0
    };

    // Churn rate calculation
    let total_at_start = active_subscriptions + churned_subscribers_30d;
    let churn_rate = if total_at_start > 0 {
        (churned_subscribers_30d as f64 / total_at_start as f64) * 100.0
    } else {
        0.0
    };

    // LTV estimate (MRR / monthly churn rate)
    let monthly_churn_rate = churn_rate / 100.0;
    let ltv_estimate = if monthly_churn_rate > 0.0 {
        arpu / monthly_churn_rate
    } else {
        arpu * 24.0 // Default to 24 month lifetime if no churn
    };

    // Net new MRR
    let net_new_mrr = new_mrr - churned_mrr;

    // Calculate previous month MRR by subtracting net changes
    // previous_mrr = current_mrr - (new_mrr - churned_mrr)
    let previous_mrr = mrr - net_new_mrr;

    // Revenue growth rate: (net_new_mrr / previous_mrr) * 100
    let revenue_growth_rate = if previous_mrr > 0.0 {
        (net_new_mrr / previous_mrr) * 100.0
    } else if mrr > 0.0 {
        100.0 // If no previous MRR but have current, that's 100% growth
    } else {
        0.0
    };

    // Subscriber growth rate: net new subscribers / previous subscribers * 100
    let net_new_subscribers = new_subscribers_30d - churned_subscribers_30d;
    let previous_subscribers = active_subscriptions - net_new_subscribers;
    let subscriber_growth_rate = if previous_subscribers > 0 {
        (net_new_subscribers as f64 / previous_subscribers as f64) * 100.0
    } else if active_subscriptions > 0 {
        100.0 // If no previous subscribers but have current, that's 100% growth
    } else {
        0.0
    };

    println!("Growth rates - MRR: {:.1}% (new: ${}, churned: ${}, prev: ${}), Subscribers: {:.1}% (new: {}, churned: {}, prev: {})",
        revenue_growth_rate, new_mrr, churned_mrr, previous_mrr,
        subscriber_growth_rate, new_subscribers_30d, churned_subscribers_30d, previous_subscribers);

    // MRR Bridge
    let mrr_bridge = MrrBridge {
        new_mrr,
        expansion_mrr: 0.0, // Would need subscription history to calculate
        contraction_mrr: 0.0,
        churned_mrr,
        reactivation_mrr: 0.0,
        net_new_mrr,
    };

    // Fetch daily charges for the last 30 days (for chart data)
    let mut daily_revenue: Vec<DailyRevenue> = Vec::new();
    let mut daily_totals: HashMap<String, f64> = HashMap::new();

    // Initialize all 30 days with 0
    for i in 0..30 {
        let date = (chrono::Utc::now() - chrono::Duration::days(29 - i)).format("%Y-%m-%d").to_string();
        daily_totals.insert(date, 0.0);
    }

    // Fetch charges and group by day
    let charges_for_chart = client
        .get("https://api.stripe.com/v1/charges")
        .query(&[
            ("limit", "100"),
            ("created[gte]", &thirty_days_ago.timestamp().to_string()),
        ])
        .basic_auth(api_key, None::<&str>)
        .send()
        .await
        .ok();

    if let Some(resp) = charges_for_chart {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            if let Some(charges) = data["data"].as_array() {
                for charge in charges {
                    if charge["status"].as_str() == Some("succeeded") {
                        if let (Some(created), Some(amount)) = (charge["created"].as_i64(), charge["amount"].as_i64()) {
                            let date = chrono::DateTime::from_timestamp(created, 0)
                                .map(|dt| dt.format("%Y-%m-%d").to_string())
                                .unwrap_or_default();
                            if let Some(total) = daily_totals.get_mut(&date) {
                                *total += amount as f64 / 100.0;
                            }
                        }
                    }
                }
            }
        }
    }

    // Convert to sorted vector
    let mut dates: Vec<String> = daily_totals.keys().cloned().collect();
    dates.sort();
    for date in dates {
        daily_revenue.push(DailyRevenue {
            date: date.clone(),
            revenue: *daily_totals.get(&date).unwrap_or(&0.0),
        });
    }

    // For daily subscribers, we'll use the current count repeated (we'd need historical data for accurate tracking)
    let daily_subscribers: Vec<i32> = vec![active_subscriptions; 30];

    Ok(StripeMetrics {
        mrr,
        arr,
        active_subscriptions,
        revenue_30d,
        churn_rate,
        new_mrr,
        expansion_mrr: 0.0,
        churned_mrr,
        net_new_mrr,
        new_subscribers_30d,
        churned_subscribers_30d,
        revenue_growth_rate,
        subscriber_growth_rate,
        arpu,
        ltv_estimate,
        revenue_by_plan,
        mrr_bridge,
        trial_conversion_rate: 0.0, // Would need trial tracking
        average_revenue_per_subscription: arpu,
        daily_revenue,
        daily_subscribers,
    })
}

async fn fetch_stripe_events(
    client: &reqwest::Client,
    api_key: &str,
) -> Result<Vec<StripeEvent>, String> {
    let response = client
        .get("https://api.stripe.com/v1/events")
        .query(&[
            ("limit", "20"),
            ("type", "invoice.paid"),
            ("type", "invoice.payment_failed"),
            ("type", "customer.subscription.created"),
            ("type", "customer.subscription.deleted"),
            ("type", "charge.succeeded"),
        ])
        .basic_auth(api_key, None::<&str>)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let empty_vec = vec![];
    let events = data["data"].as_array().unwrap_or(&empty_vec);

    let stripe_events: Vec<StripeEvent> = events
        .iter()
        .filter_map(|event| {
            let event_type = event["type"].as_str()?;
            let id = event["id"].as_str()?.to_string();
            let created = event["created"].as_i64()?;
            let obj = &event["data"]["object"];

            let (description, amount, customer_email, plan_name, currency) = match event_type {
                "invoice.paid" => {
                    let amt = obj["amount_paid"].as_i64();
                    let email = obj["customer_email"].as_str().map(|s| s.to_string());
                    let curr = obj["currency"].as_str().map(|s| s.to_string());
                    (
                        format!("Invoice paid for {}", email.as_deref().unwrap_or("customer")),
                        amt,
                        email,
                        None,
                        curr,
                    )
                }
                "invoice.payment_failed" => {
                    let amt = obj["amount_due"].as_i64();
                    let email = obj["customer_email"].as_str().map(|s| s.to_string());
                    (
                        format!("Payment failed for {}", email.as_deref().unwrap_or("customer")),
                        amt,
                        email,
                        None,
                        None,
                    )
                }
                "customer.subscription.created" => {
                    let plan = obj["items"]["data"][0]["price"]["nickname"]
                        .as_str()
                        .or_else(|| obj["items"]["data"][0]["price"]["product"].as_str())
                        .map(|s| s.to_string());
                    (
                        "New subscription created".to_string(),
                        None,
                        None,
                        plan,
                        None,
                    )
                }
                "customer.subscription.deleted" => {
                    ("Subscription canceled".to_string(), None, None, None, None)
                }
                "charge.succeeded" => {
                    let amt = obj["amount"].as_i64();
                    let email = obj["billing_details"]["email"].as_str().map(|s| s.to_string());
                    let curr = obj["currency"].as_str().map(|s| s.to_string());
                    (
                        format!("Payment received from {}", email.as_deref().unwrap_or("customer")),
                        amt,
                        email,
                        None,
                        curr,
                    )
                }
                _ => (event_type.to_string(), None, None, None, None),
            };

            Some(StripeEvent {
                id,
                event_type: event_type.to_string(),
                created,
                description,
                amount,
                customer_email,
                plan_name,
                currency,
            })
        })
        .collect();

    Ok(stripe_events)
}

// ==========================================
// Vercel API Functions
// ==========================================

async fn fetch_vercel_metrics(
    client: &reqwest::Client,
    api_key: &str,
    project_id: &str,
    team_id: Option<&str>,
) -> Result<VercelMetrics, String> {
    // Build URL with optional teamId
    let url = match team_id {
        Some(team) => format!(
            "https://api.vercel.com/v6/deployments?projectId={}&teamId={}&limit=5",
            project_id, team
        ),
        None => format!(
            "https://api.vercel.com/v6/deployments?projectId={}&limit=5",
            project_id
        ),
    };

    let response = client
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let empty_deployments = vec![];
    let deployments: Vec<Deployment> = data["deployments"]
        .as_array()
        .unwrap_or(&empty_deployments)
        .iter()
        .take(5)
        .filter_map(|d| {
            Some(Deployment {
                id: d["uid"].as_str()?.to_string(),
                name: d["name"].as_str()?.to_string(),
                state: d["state"].as_str().unwrap_or("unknown").to_string(),
                created_at: d["createdAt"].to_string(),
                url: d["url"].as_str().unwrap_or("").to_string(),
            })
        })
        .collect();

    let latest_status = deployments
        .first()
        .map(|d| d.state.clone())
        .unwrap_or_else(|| "unknown".to_string());

    let last_deployed_at = deployments.first().map(|d| d.created_at.clone());

    Ok(VercelMetrics {
        deployments,
        last_deployed_at,
        status: latest_status,
    })
}

// ==========================================
// PostHog API Functions
// ==========================================

async fn fetch_posthog_metrics(
    client: &reqwest::Client,
    api_key: &str,
    project_id: &str,
) -> Result<PostHogMetrics, String> {
    // PostHog uses a different API structure - this is a simplified version
    let response = client
        .get(format!(
            "https://app.posthog.com/api/projects/{}/insights/trend/",
            project_id
        ))
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        // For now, return placeholder data - real implementation would parse the response
        Ok(PostHogMetrics {
            total_events_24h: 0,
            unique_users_24h: 0,
            total_events_7d: 0,
            unique_users_7d: 0,
        })
    } else {
        Err("Failed to fetch PostHog metrics".to_string())
    }
}

// ==========================================
// Supabase API Functions
// ==========================================

async fn fetch_supabase_metrics(
    client: &reqwest::Client,
    api_key: &str,  // This should be the service_role key
    project_id: &str,  // This is the project ref (e.g., "xyzcompany")
) -> Result<SupabaseMetrics, String> {
    // Use Supabase Auth Admin API to list users
    // The project_id should be the project reference (e.g., "abcdefghijklmnop")
    // API key should be the service_role key
    let auth_url = format!(
        "https://{}.supabase.co/auth/v1/admin/users",
        project_id
    );

    println!("Fetching Supabase users from: {}", auth_url);

    let response = client
        .get(&auth_url)
        .header("apikey", api_key)
        .header("Authorization", format!("Bearer {}", api_key))
        .query(&[("page", "1"), ("per_page", "1000")])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    println!("Supabase response status: {}", status);

    if status.is_success() {
        let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

        // The response has { users: [...], aud: "...", ... }
        let users = data["users"].as_array();
        let total_users = users.map(|u| u.len() as i32).unwrap_or(0);

        // Count users created in last 7 days
        let seven_days_ago = chrono::Utc::now() - chrono::Duration::days(7);
        let new_users_7d = users
            .map(|users_arr| {
                users_arr
                    .iter()
                    .filter(|user| {
                        user["created_at"]
                            .as_str()
                            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                            .map(|dt| dt > seven_days_ago)
                            .unwrap_or(false)
                    })
                    .count() as i32
            })
            .unwrap_or(0);

        println!("Found {} total users, {} new in last 7 days", total_users, new_users_7d);

        Ok(SupabaseMetrics {
            total_users,
            new_users_7d,
            database_size: "N/A".to_string(),
            api_requests_24h: 0,
        })
    } else {
        let error_text = response.text().await.unwrap_or_default();
        println!("Supabase error: {}", error_text);
        Err(format!("Failed to fetch Supabase metrics: {}", status))
    }
}

// ==========================================
// Google Calendar OAuth
// ==========================================
//
// TODO: For production/indie release, implement "Bring Your Own Credentials" feature:
// - Let users provide their own Google OAuth Client ID & Secret in Settings
// - Pass credentials from frontend to these functions instead of using hardcoded values
// - This avoids Google's app verification process and scales infinitely
// - Current setup requires manually adding test users in Google Cloud Console

// These are embedded at compile time from environment variables
// For local dev: create .env file with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
// For CI builds: set as GitHub Actions secrets
// A build without them still compiles; Google sign-in (SaaS metrics only) then says so.
const GOOGLE_CLIENT_ID: Option<&str> = option_env!("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET: Option<&str> = option_env!("GOOGLE_CLIENT_SECRET");

fn google_client() -> Result<(&'static str, &'static str), String> {
    match (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) {
        (Some(id), Some(secret)) => Ok((id, secret)),
        _ => Err("Google sign-in is not configured in this build (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET were not set at compile time)".to_string()),
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct GoogleCalendarEvent {
    id: String,
    summary: Option<String>,
    start: Option<GoogleEventTime>,
    end: Option<GoogleEventTime>,
    description: Option<String>,
    #[serde(rename = "htmlLink")]
    html_link: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GoogleEventTime {
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GoogleCalendarList {
    items: Option<Vec<GoogleCalendarEvent>>,
}

// Loopback OAuth flow - opens browser, waits for callback, returns tokens
#[tauri::command]
async fn start_google_oauth() -> Result<String, String> {
    use tokio::net::TcpListener;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (client_id, client_secret) = google_client()?;

    // Bind to a random available port on localhost
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind: {}", e))?;

    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get local addr: {}", e))?
        .port();

    let redirect_uri = format!("http://127.0.0.1:{}", port);
    // Request both Calendar and Gmail scopes
    let scopes = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly";

    // Build the auth URL
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent",
        client_id,
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(scopes)
    );

    // Open the browser
    if let Err(e) = open::that(&auth_url) {
        return Err(format!("Failed to open browser: {}", e));
    }

    // Wait for the OAuth callback (with 5 minute timeout)
    let code = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        async {
            let (mut socket, _) = listener.accept()
                .await
                .map_err(|e| format!("Failed to accept connection: {}", e))?;

            let mut buffer = vec![0u8; 4096];
            let n = socket.read(&mut buffer)
                .await
                .map_err(|e| format!("Failed to read: {}", e))?;

            let request = String::from_utf8_lossy(&buffer[..n]);

            // Parse the code from the request
            let code = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|path| {
                    if path.starts_with("/?code=") {
                        path.strip_prefix("/?code=")
                            .and_then(|s| s.split('&').next())
                            .map(|s| urlencoding::decode(s).unwrap_or_default().to_string())
                    } else if path.contains("code=") {
                        path.split("code=")
                            .nth(1)
                            .and_then(|s| s.split('&').next())
                            .map(|s| urlencoding::decode(s).unwrap_or_default().to_string())
                    } else {
                        None
                    }
                })
                .ok_or_else(|| "No authorization code found in callback".to_string())?;

            // Send a success response to the browser
            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
                <html><body style=\"font-family: system-ui; text-align: center; padding: 50px;\">\
                <h1>Authorization Successful!</h1>\
                <p>You can close this window and return to Pulse.</p>\
                <script>window.close();</script>\
                </body></html>";

            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.flush().await;

            Ok::<String, String>(code)
        }
    )
    .await
    .map_err(|_| "OAuth timed out after 5 minutes".to_string())??;

    // Exchange the code for tokens
    let client = reqwest::Client::new();
    let params = [
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code", code.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri.as_str()),
    ];

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to exchange code: {}", e))?;

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;

    if status.is_success() {
        Ok(body)
    } else {
        Err(format!("Token exchange failed: {}", body))
    }
}

#[tauri::command]
async fn refresh_google_token(refresh_token: String) -> Result<String, String> {
    let (client_id, client_secret) = google_client()?;
    let client = reqwest::Client::new();

    let params = [
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("refresh_token", &refresh_token),
        ("grant_type", "refresh_token"),
    ];

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to refresh token: {}", e))?;

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;

    if status.is_success() {
        Ok(body)
    } else {
        Err(format!("Token refresh failed: {}", body))
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct GoogleCalendarListEntry {
    id: String,
    summary: Option<String>,
    #[serde(rename = "backgroundColor")]
    background_color: Option<String>,
    #[serde(rename = "foregroundColor")]
    foreground_color: Option<String>,
    primary: Option<bool>,
    selected: Option<bool>,
    #[serde(rename = "accessRole")]
    access_role: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GoogleCalendarListResponse {
    items: Option<Vec<GoogleCalendarListEntry>>,
}

#[tauri::command]
async fn fetch_google_calendar(access_token: String) -> Result<String, String> {
    println!("Fetching Google Calendar events from ALL calendars...");
    let client = reqwest::Client::new();

    // Calculate time range: start of current month to end of next month
    let now = chrono::Utc::now();
    let start_of_month = now
        .with_day(1)
        .unwrap_or(now)
        .with_hour(0).unwrap_or(now)
        .with_minute(0).unwrap_or(now)
        .with_second(0).unwrap_or(now);
    let time_min = start_of_month.to_rfc3339();
    // Go to end of next month (roughly 60 days to be safe)
    let time_max = (now + chrono::Duration::days(60)).to_rfc3339();

    println!("Time range: {} to {}", time_min, time_max);

    // First, fetch the list of all calendars the user has access to
    let calendar_list_url = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
    let calendar_list_response = client
        .get(calendar_list_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch calendar list: {}", e))?;

    let list_status = calendar_list_response.status();
    if list_status.as_u16() == 401 {
        return Err("TOKEN_EXPIRED".to_string());
    }

    let calendar_list_body = calendar_list_response.text().await.map_err(|e| e.to_string())?;

    if !list_status.is_success() {
        return Err(format!("Calendar list fetch failed: {}", calendar_list_body));
    }

    // Parse the calendar list
    let calendars: Vec<GoogleCalendarListEntry> = match serde_json::from_str::<GoogleCalendarListResponse>(&calendar_list_body) {
        Ok(response) => response.items.unwrap_or_default(),
        Err(e) => {
            println!("Failed to parse calendar list: {}", e);
            // Fall back to just primary calendar
            vec![GoogleCalendarListEntry {
                id: "primary".to_string(),
                summary: Some("Primary".to_string()),
                background_color: None,
                foreground_color: None,
                primary: Some(true),
                selected: Some(true),
                access_role: None,
            }]
        }
    };

    println!("Found {} calendars", calendars.len());
    for cal in &calendars {
        println!("  - {} ({})", cal.summary.as_deref().unwrap_or("Unknown"), cal.id);
    }

    // Fetch events from each calendar
    let mut all_events: Vec<serde_json::Value> = Vec::new();

    for calendar in &calendars {
        // Skip calendars marked as not selected (if the field exists and is false)
        // Most calendars don't have this field, so we include them by default

        let calendar_id = urlencoding::encode(&calendar.id);
        let url = format!(
            "https://www.googleapis.com/calendar/v3/calendars/{}/events?timeMin={}&timeMax={}&singleEvents=true&orderBy=startTime&maxResults=250",
            calendar_id,
            urlencoding::encode(&time_min),
            urlencoding::encode(&time_max)
        );

        let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await;

        match response {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    let body = resp.text().await.unwrap_or_default();
                    if let Ok(calendar_data) = serde_json::from_str::<GoogleCalendarList>(&body) {
                        let events: Vec<serde_json::Value> = calendar_data.items
                            .unwrap_or_default()
                            .into_iter()
                            .filter_map(|event| {
                                let start_time = event.start.as_ref()
                                    .and_then(|s| s.date_time.clone().or(s.date.clone()))
                                    .unwrap_or_default();
                                let end_time = event.end.as_ref()
                                    .and_then(|e| e.date_time.clone().or(e.date.clone()))
                                    .unwrap_or_default();

                                Some(serde_json::json!({
                                    "id": event.id,
                                    "title": event.summary.unwrap_or_else(|| "(No title)".to_string()),
                                    "startTime": start_time,
                                    "endTime": end_time,
                                    "source": "google",
                                    "type": "meeting",
                                    "description": event.description,
                                    "url": event.html_link,
                                    "calendarName": calendar.summary,
                                    "calendarColor": calendar.background_color
                                }))
                            })
                            .collect();

                        println!("  Calendar '{}': {} events",
                            calendar.summary.as_deref().unwrap_or("Unknown"),
                            events.len());
                        all_events.extend(events);
                    }
                } else {
                    println!("  Calendar '{}': failed to fetch ({})",
                        calendar.summary.as_deref().unwrap_or("Unknown"),
                        status);
                }
            }
            Err(e) => {
                println!("  Calendar '{}': request failed ({})",
                    calendar.summary.as_deref().unwrap_or("Unknown"),
                    e);
            }
        }
    }

    // Sort all events by start time
    all_events.sort_by(|a, b| {
        let a_time = a["startTime"].as_str().unwrap_or("");
        let b_time = b["startTime"].as_str().unwrap_or("");
        a_time.cmp(b_time)
    });

    println!("Total events from all calendars: {}", all_events.len());
    Ok(serde_json::to_string(&all_events).unwrap_or_else(|_| "[]".to_string()))
}

// ==========================================
// Gmail API
// ==========================================

#[derive(Debug, Serialize, Deserialize)]
struct GmailLabel {
    id: String,
    name: String,
    #[serde(rename = "type")]
    label_type: Option<String>,
    color: Option<GmailLabelColor>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GmailLabelColor {
    #[serde(rename = "backgroundColor")]
    background_color: Option<String>,
    #[serde(rename = "textColor")]
    text_color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GmailMessageHeader {
    name: String,
    value: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GmailMessagePayload {
    headers: Option<Vec<GmailMessageHeader>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GmailMessageDetail {
    id: String,
    #[serde(rename = "threadId")]
    thread_id: String,
    #[serde(rename = "labelIds")]
    label_ids: Option<Vec<String>>,
    snippet: Option<String>,
    payload: Option<GmailMessagePayload>,
    #[serde(rename = "internalDate")]
    internal_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GmailMessageListItem {
    id: String,
    #[serde(rename = "threadId")]
    thread_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GmailMessageList {
    messages: Option<Vec<GmailMessageListItem>>,
    #[serde(rename = "resultSizeEstimate")]
    result_size_estimate: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GmailLabelsResponse {
    labels: Option<Vec<GmailLabel>>,
}

#[tauri::command]
async fn fetch_gmail(access_token: String) -> Result<String, String> {
    println!("Fetching Gmail messages...");
    let client = reqwest::Client::new();

    // First, fetch all labels to get their names and colors
    let labels_response = client
        .get("https://gmail.googleapis.com/gmail/v1/users/me/labels")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch labels: {}", e))?;

    let labels_data: GmailLabelsResponse = labels_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse labels: {}", e))?;

    let labels: std::collections::HashMap<String, (String, Option<String>)> = labels_data
        .labels
        .unwrap_or_default()
        .into_iter()
        .map(|l| {
            let color = l.color.and_then(|c| c.background_color);
            (l.id.clone(), (l.name.clone(), color))
        })
        .collect();

    // Fetch unread messages from inbox (limit to 20)
    let messages_response = client
        .get("https://gmail.googleapis.com/gmail/v1/users/me/messages")
        .query(&[
            ("q", "is:unread"),
            ("maxResults", "20"),
        ])
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch messages: {}", e))?;

    let messages_list: GmailMessageList = messages_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse messages list: {}", e))?;

    let unread_count = messages_list.result_size_estimate.unwrap_or(0);
    let message_ids: Vec<String> = messages_list
        .messages
        .unwrap_or_default()
        .into_iter()
        .take(10) // Only fetch details for first 10
        .map(|m| m.id)
        .collect();

    // Fetch full details for each message
    let mut messages = Vec::new();
    for msg_id in message_ids {
        let msg_response = client
            .get(&format!(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}",
                msg_id
            ))
            .query(&[("format", "metadata"), ("metadataHeaders", "From"), ("metadataHeaders", "Subject")])
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await;

        if let Ok(response) = msg_response {
            if let Ok(detail) = response.json::<GmailMessageDetail>().await {
                // Extract headers
                let headers = detail.payload.and_then(|p| p.headers).unwrap_or_default();
                let from = headers.iter()
                    .find(|h| h.name.to_lowercase() == "from")
                    .map(|h| h.value.clone())
                    .unwrap_or_default();
                let subject = headers.iter()
                    .find(|h| h.name.to_lowercase() == "subject")
                    .map(|h| h.value.clone())
                    .unwrap_or_default();

                // Parse "from" to extract name and email
                let (from_name, from_email) = if from.contains('<') {
                    let parts: Vec<&str> = from.splitn(2, '<').collect();
                    let name = parts.get(0).map(|s| s.trim().trim_matches('"').to_string());
                    let email = parts.get(1).map(|s| s.trim_end_matches('>').to_string()).unwrap_or(from.clone());
                    (name, email)
                } else {
                    (None, from.clone())
                };

                // Extract label IDs and check unread status first
                let label_ids = detail.label_ids.unwrap_or_default();
                let is_unread = label_ids.contains(&"UNREAD".to_string());

                // Resolve label IDs to label objects
                let msg_labels: Vec<serde_json::Value> = label_ids
                    .iter()
                    .filter_map(|id| {
                        labels.get(id).map(|(name, color)| {
                            serde_json::json!({
                                "id": id,
                                "name": name,
                                "color": color,
                                "type": if id.starts_with("CATEGORY_") || ["INBOX", "SENT", "DRAFT", "SPAM", "TRASH", "UNREAD", "STARRED", "IMPORTANT"].contains(&id.as_str()) { "system" } else { "user" }
                            })
                        })
                    })
                    .collect();

                // Parse internal date
                let date: i64 = detail.internal_date
                    .and_then(|d| d.parse().ok())
                    .unwrap_or(0) / 1000; // Convert ms to seconds

                messages.push(serde_json::json!({
                    "id": detail.id,
                    "threadId": detail.thread_id,
                    "from": from_email,
                    "fromName": from_name,
                    "subject": subject,
                    "snippet": detail.snippet.unwrap_or_default(),
                    "date": date,
                    "labels": msg_labels,
                    "isUnread": is_unread
                }));
            }
        }
    }

    // Return combined metrics and messages
    let result = serde_json::json!({
        "metrics": {
            "unreadCount": unread_count,
            "inboxCount": messages.len(),
            "primaryUnread": unread_count, // Could filter further if needed
            "lastFetched": chrono::Utc::now().to_rfc3339()
        },
        "messages": messages
    });

    println!("Fetched {} Gmail messages, {} unread", messages.len(), unread_count);
    Ok(serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string()))
}

// ==========================================
// GitHub API
// ==========================================

#[derive(Debug, Serialize, Deserialize)]
struct GitHubNotification {
    id: String,
    unread: bool,
    reason: String,
    updated_at: String,
    subject: GitHubNotificationSubject,
    repository: GitHubNotificationRepo,
}

#[derive(Debug, Serialize, Deserialize)]
struct GitHubNotificationSubject {
    title: String,
    url: Option<String>,
    #[serde(rename = "type")]
    subject_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GitHubNotificationRepo {
    full_name: String,
    html_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GitHubRepo {
    name: String,
    full_name: String,
    stargazers_count: i32,
    forks_count: i32,
    open_issues_count: i32,
    watchers_count: i32,
    html_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GitHubEvent {
    id: String,
    #[serde(rename = "type")]
    event_type: String,
    created_at: String,
    repo: GitHubEventRepo,
    payload: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GitHubEventRepo {
    name: String,
}

#[tauri::command]
async fn fetch_github_metrics(token: String, username: String, repos: Vec<String>) -> Result<String, String> {
    println!("Fetching GitHub metrics for {} repos...", repos.len());
    let client = reqwest::Client::new();

    // Fetch notifications
    let notif_response = client
        .get("https://api.github.com/notifications")
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Pulse-Dashboard")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch notifications: {}", e))?;

    let notifications: Vec<GitHubNotification> = if notif_response.status().is_success() {
        notif_response.json().await.unwrap_or_default()
    } else {
        Vec::new()
    };

    // Transform notifications
    let notif_data: Vec<serde_json::Value> = notifications
        .into_iter()
        .take(20)
        .map(|n| {
            serde_json::json!({
                "id": n.id,
                "type": n.subject.subject_type,
                "title": n.subject.title,
                "reason": n.reason,
                "repoName": n.repository.full_name,
                "url": n.subject.url.unwrap_or(n.repository.html_url),
                "updatedAt": n.updated_at,
                "unread": n.unread
            })
        })
        .collect();

    // Fetch repo stats
    let mut total_stars = 0;
    let mut total_forks = 0;
    let mut total_issues = 0;
    let mut repo_stats = Vec::new();

    for repo_name in &repos {
        let repo_response = client
            .get(&format!("https://api.github.com/repos/{}", repo_name))
            .header("Authorization", format!("Bearer {}", token))
            .header("User-Agent", "Pulse-Dashboard")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await;

        if let Ok(response) = repo_response {
            if response.status().is_success() {
                if let Ok(repo) = response.json::<GitHubRepo>().await {
                    total_stars += repo.stargazers_count;
                    total_forks += repo.forks_count;
                    total_issues += repo.open_issues_count;

                    repo_stats.push(serde_json::json!({
                        "name": repo.name,
                        "fullName": repo.full_name,
                        "stars": repo.stargazers_count,
                        "forks": repo.forks_count,
                        "openIssues": repo.open_issues_count,
                        "openPRs": 0, // Would need separate API call
                        "watchers": repo.watchers_count
                    }));
                }
            }
        }
    }

    // Fetch recent activity/events
    let events_response = client
        .get(&format!("https://api.github.com/users/{}/events", username))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "Pulse-Dashboard")
        .header("Accept", "application/vnd.github+json")
        .query(&[("per_page", "30")])
        .send()
        .await;

    let activity: Vec<serde_json::Value> = if let Ok(response) = events_response {
        if response.status().is_success() {
            let events: Vec<GitHubEvent> = response.json().await.unwrap_or_default();
            events
                .into_iter()
                .take(15)
                .map(|e| {
                    let event_type = match e.event_type.as_str() {
                        "PushEvent" => "push",
                        "PullRequestEvent" => "pr",
                        "IssuesEvent" => "issue",
                        "WatchEvent" => "star",
                        "ForkEvent" => "fork",
                        "ReleaseEvent" => "release",
                        "IssueCommentEvent" | "PullRequestReviewCommentEvent" => "comment",
                        _ => "other"
                    };

                    let description = match e.event_type.as_str() {
                        "PushEvent" => {
                            let commits = e.payload
                                .as_ref()
                                .and_then(|p| p.get("commits"))
                                .and_then(|c| c.as_array())
                                .map(|c| c.len())
                                .unwrap_or(0);
                            format!("Pushed {} commit(s)", commits)
                        }
                        "PullRequestEvent" => {
                            let action = e.payload
                                .as_ref()
                                .and_then(|p| p.get("action"))
                                .and_then(|a| a.as_str())
                                .unwrap_or("updated");
                            format!("Pull request {}", action)
                        }
                        "IssuesEvent" => {
                            let action = e.payload
                                .as_ref()
                                .and_then(|p| p.get("action"))
                                .and_then(|a| a.as_str())
                                .unwrap_or("updated");
                            format!("Issue {}", action)
                        }
                        "WatchEvent" => "Starred repository".to_string(),
                        "ForkEvent" => "Forked repository".to_string(),
                        "ReleaseEvent" => "Created release".to_string(),
                        _ => e.event_type.replace("Event", "")
                    };

                    serde_json::json!({
                        "id": e.id,
                        "type": event_type,
                        "repoName": e.repo.name,
                        "description": description,
                        "timestamp": e.created_at
                    })
                })
                .collect()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    let result = serde_json::json!({
        "totalStars": total_stars,
        "totalForks": total_forks,
        "openIssues": total_issues,
        "openPRs": 0, // Would need separate API calls per repo
        "notifications": notif_data,
        "recentActivity": activity,
        "repos": repo_stats
    });

    println!("Fetched GitHub metrics: {} stars, {} notifications", total_stars, notif_data.len());
    Ok(serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string()))
}

// ==========================================
// Portfolio (org board): read-only, local files under ~/portfolio only
// ==========================================

// Status reports are small; anything bigger is treated as malformed.
const PORTFOLIO_MAX_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
struct PortfolioEntityReport {
    id: String,
    status: Option<serde_json::Value>,
    error: Option<String>,
    logo: Option<String>,      // data: URL of the registry's `logo`
    logo_dark: Option<String>, // data: URL of `logo_dark`, for dark themes
    logo_error: Option<String>,
}

// Logos live in ~/portfolio/assets/ so the board's reads never leave ~/portfolio.
const LOGO_DIR: &str = "assets";
const LOGO_TYPES: &[(&str, &str)] = &[
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
];

fn base64_encode(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ABC[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

// Reads a registry logo path (relative to ~/portfolio, inside assets/) as a data: URL.
// Same guard as status files: no absolute paths, no `..`, no symlinks out of the root.
fn read_portfolio_logo(root: &Path, rel: &str) -> Result<String, String> {
    let rel_path = Path::new(rel);
    let (Some(dir), Some(name)) = (rel_path.parent(), rel_path.file_name().and_then(|n| n.to_str())) else {
        return Err(format!("{}: not a file path", rel));
    };
    if !rel_path.starts_with(LOGO_DIR) {
        return Err(format!("{}: logos must live in ~/portfolio/{}/", rel, LOGO_DIR));
    }
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let Some((_, mime)) = LOGO_TYPES.iter().find(|(e, _)| *e == ext) else {
        return Err(format!("{}: not an svg, png, jpg or webp", rel));
    };
    let dir = dir.to_str().ok_or_else(|| format!("{}: not a file path", rel))?;
    let path = resolve_portfolio_file(root, dir, name).map_err(|e| format!("{}: {}", rel, e))?;
    if !path.starts_with(root.join(LOGO_DIR)) {
        return Err(format!("{}: logos must live in ~/portfolio/{}/", rel, LOGO_DIR));
    }
    let meta = fs::metadata(&path).map_err(|_| format!("{}: missing", rel))?;
    if meta.len() > PORTFOLIO_MAX_FILE_BYTES {
        return Err(format!("{}: file too large (1 MB max)", rel));
    }
    let bytes = fs::read(&path).map_err(|e| format!("{}: unreadable: {}", rel, e))?;
    Ok(format!("data:{};base64,{}", mime, base64_encode(&bytes)))
}

#[derive(Serialize)]
struct PortfolioSnapshot {
    registry: Option<serde_json::Value>,
    registry_error: Option<String>,
    entities: Vec<PortfolioEntityReport>,
    week: Option<String>,
    read_at: String,
}

fn get_portfolio_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    home.join("portfolio")
        .canonicalize()
        .map_err(|_| "~/portfolio not found".to_string())
}

// Resolves a registry-relative path to a file inside ~/portfolio. Rejects absolute
// paths, `..`, and symlinks that escape the root, so the board can never read elsewhere.
fn resolve_portfolio_file(root: &Path, rel_dir: &str, file_name: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel_dir);
    if rel.is_absolute() || rel.components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err("path is outside ~/portfolio".to_string());
    }
    let candidate = root.join(rel).join(file_name);
    let resolved = candidate.canonicalize().map_err(|_| "missing".to_string())?;
    if !resolved.starts_with(root) {
        return Err("path is outside ~/portfolio".to_string());
    }
    Ok(resolved)
}

fn read_portfolio_text(path: &Path) -> Result<String, String> {
    read_text_capped(path, PORTFOLIO_MAX_FILE_BYTES)
}

fn read_text_capped(path: &Path, max_bytes: u64) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|_| "missing".to_string())?;
    if !meta.is_file() {
        return Err("missing".to_string());
    }
    if meta.len() > max_bytes {
        return Err("file too large".to_string());
    }
    fs::read_to_string(path).map_err(|e| format!("unreadable: {}", e))
}

fn read_portfolio_json(path: &Path) -> Result<serde_json::Value, String> {
    let text = read_portfolio_text(path)?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("malformed: {}", e))?;
    if !value.is_object() {
        return Err("malformed: not a JSON object".to_string());
    }
    Ok(value)
}

#[tauri::command]
fn read_portfolio() -> Result<String, String> {
    let read_at = chrono::Local::now().to_rfc3339();
    let root = match get_portfolio_dir() {
        Ok(root) => root,
        Err(e) => {
            let snapshot = PortfolioSnapshot {
                registry: None,
                registry_error: Some(e),
                entities: vec![],
                week: None,
                read_at,
            };
            return serde_json::to_string(&snapshot).map_err(|e| e.to_string());
        }
    };

    let (registry, registry_error) = match resolve_portfolio_file(&root, ".", "portfolio.json")
        .and_then(|p| read_portfolio_json(&p))
    {
        Ok(v) => (Some(v), None),
        Err(e) => (None, Some(e)),
    };

    let mut entities = Vec::new();
    if let Some(list) = registry.as_ref().and_then(|r| r.get("entities")).and_then(|e| e.as_array()) {
        for entity in list {
            let Some(id) = entity.get("id").and_then(|v| v.as_str()) else { continue };
            let (status, error) = match entity.get("path").and_then(|v| v.as_str()) {
                Some(rel) => match resolve_portfolio_file(&root, rel, "status.json")
                    .and_then(|p| read_portfolio_json(&p))
                {
                    Ok(status) => (Some(status), None),
                    Err(e) => (None, Some(e)),
                },
                None => (None, Some("no path in portfolio.json".to_string())),
            };
            let mut logo_errors = Vec::new();
            let mut logo = |key: &str| {
                let rel = entity.get(key).and_then(|v| v.as_str())?;
                read_portfolio_logo(&root, rel).map_err(|e| logo_errors.push(e)).ok()
            };
            let (logo, logo_dark) = (logo("logo"), logo("logo_dark"));
            entities.push(PortfolioEntityReport {
                id: id.to_string(),
                status,
                error,
                logo,
                logo_dark,
                logo_error: (!logo_errors.is_empty()).then(|| logo_errors.join("; ")),
            });
        }
    }

    let week = resolve_portfolio_file(&root, ".", "WEEK.md")
        .and_then(|p| read_portfolio_text(&p))
        .ok();

    let snapshot = PortfolioSnapshot { registry, registry_error, entities, week, read_at };
    serde_json::to_string(&snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_tv_fullscreen(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    window.set_fullscreen(enabled).map_err(|e| e.to_string())
}

// ==========================================
// Tracker (~/project-tracker): read-only, a fixed allowlist of files
// ==========================================

// tasks.json keeps every task ever seen, so it is allowed to be bigger than a status report.
const TRACKER_MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const TRACKER_DATA_FILES: &[&str] = &[
    "tasks.json",
    "email.json",
    "scan.json",
    "stripe.json",
    "bank.json",
    "payments_email.json",
];
const TRACKER_ROOT_FILES: &[&str] = &["projects.json", "notes.json"];

fn get_tracker_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    home.join("project-tracker")
        .canonicalize()
        .map_err(|_| "~/project-tracker not found".to_string())
}

// Only the named files can be read: the data files in ~/project-tracker/data and the two
// registry files at the root. Anything else (todos.json, accounts.json, ../) is refused, and a
// symlink that resolves outside its expected directory is refused too.
fn resolve_tracker_file(root: &Path, name: &str) -> Result<PathBuf, String> {
    let dir = if TRACKER_DATA_FILES.contains(&name) {
        root.join("data")
    } else if TRACKER_ROOT_FILES.contains(&name) {
        root.to_path_buf()
    } else {
        return Err("not an allowed tracker file".to_string());
    };
    let resolved = dir.join(name).canonicalize().map_err(|_| "missing".to_string())?;
    if resolved.parent() != Some(dir.as_path()) {
        return Err("path is outside ~/project-tracker".to_string());
    }
    Ok(resolved)
}

fn read_tracker_json(root: &Path, name: &str) -> Result<serde_json::Value, String> {
    let path = resolve_tracker_file(root, name)?;
    let text = read_text_capped(&path, TRACKER_MAX_FILE_BYTES)?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("malformed: {}", e))?;
    if !value.is_object() {
        return Err("malformed: not a JSON object".to_string());
    }
    Ok(value)
}

// Each struct below names only the fields Pulse shows. serde drops everything else
// (email snippets, task evidence, repo paths, payer names, account ids) before the webview sees it.

#[derive(Deserialize, Serialize)]
struct TrackerTask {
    id: String,
    title: String,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    urgency: Option<String>,
    status: String,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    first_seen: Option<f64>,
    #[serde(default)]
    show_from: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct TrackerEmail {
    #[serde(default)]
    account_label: Option<String>,
    #[serde(default)]
    sender: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    subject: Option<String>,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    age_days: Option<f64>,
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    urgency: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Serialize)]
struct TrackerEmailSummary {
    collected_at: Option<f64>,
    stale: bool,
    age_hours: Option<f64>,
    needs_reply: Vec<TrackerEmail>,
    replied_count: usize,
    accounts_not_fetching: Vec<String>,
}

#[derive(Serialize)]
struct TrackerRepo {
    id: String,
    name: String,
    exists: bool,
    is_git: bool,
    branch: Option<String>,
    dirty_count: Option<i64>,
    days_idle: Option<f64>,
    last_commit_ts: Option<f64>,
}

#[derive(Deserialize, Serialize)]
struct TrackerProject {
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    area: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct TrackerNote {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    goal: Option<String>,
    #[serde(default)]
    next: Option<String>,
    #[serde(default)]
    blocked_on: Option<String>,
}

#[derive(Serialize)]
struct TrackerSnapshot {
    error: Option<String>,
    file_errors: HashMap<String, String>,
    tasks: Vec<TrackerTask>,
    tasks_updated_at: Option<f64>,
    email: Option<TrackerEmailSummary>,
    repos: Vec<TrackerRepo>,
    scanned_at: Option<f64>,
    money: MoneySummary,
    projects: Vec<TrackerProject>,
    notes: HashMap<String, TrackerNote>,
    read_at: String,
}

// Open and scheduled tasks only; done and stale history stays in the tracker.
fn tracker_tasks(doc: &serde_json::Value) -> Vec<TrackerTask> {
    let Some(map) = doc.get("tasks").and_then(|t| t.as_object()) else { return vec![] };
    map.values()
        .filter_map(|v| serde_json::from_value::<TrackerTask>(v.clone()).ok())
        .filter(|t| t.status == "open" || t.status == "scheduled")
        .collect()
}

fn tracker_email(doc: &serde_json::Value) -> TrackerEmailSummary {
    let needs_reply = doc
        .get("needs_reply")
        .and_then(|v| v.as_array())
        .map(|list| list.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
        .unwrap_or_default();
    let accounts_not_fetching = doc
        .get("accounts")
        .and_then(|v| v.as_object())
        .map(|accts| {
            accts.iter()
                .filter(|(_, a)| !a.get("ok").and_then(|v| v.as_bool()).unwrap_or(false))
                .map(|(id, a)| a.get("label").and_then(|v| v.as_str()).unwrap_or(id).to_string())
                .collect()
        })
        .unwrap_or_default();
    TrackerEmailSummary {
        collected_at: doc.get("collected_at").and_then(|v| v.as_f64()),
        stale: doc.get("stale").and_then(|v| v.as_bool()).unwrap_or(true),
        age_hours: doc.get("age_hours").and_then(|v| v.as_f64()),
        needs_reply,
        replied_count: doc.get("replied_to").and_then(|v| v.as_array()).map_or(0, |a| a.len()),
        accounts_not_fetching,
    }
}

fn tracker_repos(doc: &serde_json::Value) -> Vec<TrackerRepo> {
    let Some(list) = doc.get("projects").and_then(|v| v.as_array()) else { return vec![] };
    list.iter()
        .filter_map(|p| {
            let id = p.get("id")?.as_str()?.to_string();
            let git = p.get("git");
            let git_str = |k: &str| git.and_then(|g| g.get(k)).and_then(|v| v.as_str()).map(String::from);
            Some(TrackerRepo {
                name: p.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string(),
                id,
                exists: p.get("exists").and_then(|v| v.as_bool()).unwrap_or(false),
                is_git: git.and_then(|g| g.get("is_git")).and_then(|v| v.as_bool()).unwrap_or(false),
                branch: git_str("branch"),
                dirty_count: git.and_then(|g| g.get("dirty_count")).and_then(|v| v.as_i64()),
                days_idle: p.get("days_idle").and_then(|v| v.as_f64()),
                last_commit_ts: git.and_then(|g| g.get("last_commit_ts")).and_then(|v| v.as_f64()),
            })
        })
        .collect()
}

#[tauri::command]
fn read_tracker() -> Result<String, String> {
    let read_at = chrono::Local::now().to_rfc3339();
    let now = chrono::Local::now().timestamp() as f64;
    let mut snapshot = TrackerSnapshot {
        error: None,
        file_errors: HashMap::new(),
        tasks: vec![],
        tasks_updated_at: None,
        email: None,
        repos: vec![],
        scanned_at: None,
        money: build_money(&serde_json::Value::Null, &serde_json::Value::Null, &serde_json::Value::Null, now),
        projects: vec![],
        notes: HashMap::new(),
        read_at,
    };
    let root = match get_tracker_dir() {
        Ok(root) => root,
        Err(e) => {
            snapshot.error = Some(e);
            return serde_json::to_string(&snapshot).map_err(|e| e.to_string());
        }
    };

    let mut read = |name: &str| match read_tracker_json(&root, name) {
        Ok(v) => Some(v),
        Err(e) => {
            snapshot.file_errors.insert(name.to_string(), e);
            None
        }
    };
    let tasks = read("tasks.json");
    let email = read("email.json");
    let scan = read("scan.json");
    let stripe = read("stripe.json").unwrap_or_default();
    let bank = read("bank.json").unwrap_or_default();
    let payments = read("payments_email.json").unwrap_or_default();
    let projects = read("projects.json");
    let notes = read("notes.json");

    if let Some(doc) = tasks {
        snapshot.tasks = tracker_tasks(&doc);
        snapshot.tasks_updated_at = doc.get("updated_at").and_then(|v| v.as_f64());
    }
    snapshot.email = email.as_ref().map(tracker_email);
    if let Some(doc) = scan {
        snapshot.repos = tracker_repos(&doc);
        snapshot.scanned_at = doc.get("generated_at").and_then(|v| v.as_f64());
    }
    snapshot.money = build_money(&stripe, &payments, &bank, now);
    if let Some(list) = projects.as_ref().and_then(|d| d.get("projects")).and_then(|v| v.as_array()) {
        snapshot.projects = list.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect();
    }
    if let Some(map) = notes.as_ref().and_then(|d| d.get("notes")).and_then(|v| v.as_object()) {
        snapshot.notes = map
            .iter()
            .filter_map(|(k, v)| serde_json::from_value(v.clone()).ok().map(|n| (k.clone(), n)))
            .collect();
    }
    serde_json::to_string(&snapshot).map_err(|e| e.to_string())
}

// ------------------------------------------
// Money: a port of ~/project-tracker/money.py so Pulse shows the same totals as the brief.
// The same dollars often arrive three ways (Stripe charge, its payout, the bank deposit), so
// sightings are matched and only one is counted. Totals and per-project breakdowns (with
// payer names, for the owner's own screen) leave this module; raw events and descriptions do not.
// ------------------------------------------

const DAY_SECS: f64 = 86400.0;
const PAYOUT_RAILS: &[&str] = &["stripe", "venmo", "paypal", "square", "cashapp"];
const FEE_RAILS: &[&str] = &["paypal", "square", "stripe", "venmo", "cashapp"];
const NOT_INCOME_RAILS: &[&str] = &["transfer", "refund"];

#[derive(Clone, Debug)]
struct MoneyEvent {
    id: String,
    channel: &'static str,
    source: String,
    kind: String,
    amount: f64,
    net: Option<f64>,
    currency: String,
    created: f64,
    payer: String,
    project: Option<String>,
    dup_of: Option<String>,
    counted: bool,
}

struct MoneyFlag {
    kind: &'static str,
    amount: f64,
    created: f64,
}

#[derive(Serialize, Default, Debug, PartialEq)]
struct MoneyTotals {
    today: f64,
    d7: f64,
    d30: f64,
}

#[derive(Serialize)]
struct MoneySource {
    ok: bool,
}

#[derive(Serialize)]
struct MoneySummary {
    configured: bool,
    sources: HashMap<String, MoneySource>,
    totals: MoneyTotals,
    counts: HashMap<String, usize>,
    failed_30d: usize,
    refunds_30d: f64,
    mrr_total: f64,
    finance: MoneyFinance,
}

// Breakdowns for Pulse's finance views, built from the same counted events as the totals,
// so every breakdown adds up to the brief's numbers. Pulse sums tracker projects per entity.
#[derive(Serialize, Default)]
struct MoneyFinance {
    coverage: Vec<MoneyCoverage>,
    projects: Vec<ProjectFinance>,
    stripe_accounts: Vec<StripeAccount>,
    bank_accounts: Vec<BankAccount>,
}

// How far back a source's file reaches: each collector keeps `window_days` before `collected_at`.
#[derive(Serialize)]
struct MoneyCoverage {
    source: String,
    ok: bool,
    reason: Option<String>,
    collected_at: Option<f64>,
    window_days: Option<f64>,
}

#[derive(Serialize, Default)]
struct ProjectFinance {
    project: String, // tracker project id, or "unsorted"
    d30: f64,
    d90: f64,
    months: Vec<(String, f64)>,      // [YYYY-MM local, total], oldest first, every month on file
    by_channel: Vec<(String, f64)>,  // 90 days: stripe | bank | email, largest first
    by_rail: Vec<(String, String, f64)>, // 90 days: [channel, rail (zelle, venmo...), total], largest first
    payers: Vec<PayerTotal>,         // 90 days, largest first
    no_payer_90d: f64,               // counted with no payer name (payouts, bank deposits)
}

#[derive(Serialize, Debug, PartialEq)]
struct PayerTotal {
    name: String,
    total: f64,
    payments: usize,
}

#[derive(Serialize)]
struct StripeAccount {
    project: String,
    ok: bool,
    error: Option<String>,
    active: u64,
    mrr: f64,
}

#[derive(Serialize)]
struct BankAccount {
    name: String,
    org: String,
    project: Option<String>,
    balance: Option<f64>,
    currency: String,
}

fn sorted_desc(m: HashMap<String, f64>) -> Vec<(String, f64)> {
    let mut v: Vec<(String, f64)> = m.into_iter().map(|(k, a)| (k, round_cents(a))).collect();
    v.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    v
}

fn local_month(ts: f64) -> String {
    chrono::DateTime::from_timestamp(ts as i64, 0)
        .map(|t| t.with_timezone(&chrono::Local).format("%Y-%m").to_string())
        .unwrap_or_default()
}

fn money_finance(counted: &[&MoneyEvent], stripe: &serde_json::Value, mail: &serde_json::Value, bank: &serde_json::Value, now: f64) -> MoneyFinance {
    let (d30, d90) = (now - 30.0 * DAY_SECS, now - 90.0 * DAY_SECS);
    let mut by_project: HashMap<String, Vec<&MoneyEvent>> = HashMap::new();
    for e in counted {
        by_project.entry(e.project.clone().unwrap_or_else(|| "unsorted".into())).or_default().push(e);
    }
    let mut projects: Vec<ProjectFinance> = by_project
        .into_iter()
        .map(|(project, events)| {
            let recent: Vec<&&MoneyEvent> = events.iter().filter(|e| e.created >= d90).collect();
            let mut months: HashMap<String, f64> = HashMap::new();
            for e in &events {
                *months.entry(local_month(e.created)).or_default() += e.amount;
            }
            let mut months: Vec<(String, f64)> = months.into_iter().map(|(k, a)| (k, round_cents(a))).collect();
            months.sort_by(|a, b| a.0.cmp(&b.0));
            let mut channel = HashMap::new();
            let mut rail: HashMap<(String, String), f64> = HashMap::new();
            // Payers match case-insensitively; the first spelling seen is the one shown.
            let mut payers: Vec<PayerTotal> = Vec::new();
            let mut no_payer = 0.0;
            for e in &recent {
                *channel.entry(e.channel.to_string()).or_default() += e.amount;
                *rail.entry((e.channel.to_string(), e.source.clone())).or_default() += e.amount;
                let name = e.payer.trim();
                if name.is_empty() {
                    no_payer += e.amount;
                } else if let Some(p) = payers.iter_mut().find(|p| p.name.to_lowercase() == name.to_lowercase()) {
                    p.total += e.amount;
                    p.payments += 1;
                } else {
                    payers.push(PayerTotal { name: name.to_string(), total: e.amount, payments: 1 });
                }
            }
            for p in &mut payers {
                p.total = round_cents(p.total);
            }
            payers.sort_by(|a, b| b.total.total_cmp(&a.total).then_with(|| a.name.cmp(&b.name)));
            ProjectFinance {
                project,
                d30: round_cents(events.iter().filter(|e| e.created >= d30).map(|e| e.amount).sum()),
                d90: round_cents(recent.iter().map(|e| e.amount).sum()),
                months,
                by_channel: sorted_desc(channel),
                by_rail: {
                    let mut v: Vec<(String, String, f64)> = rail.into_iter().map(|((c, r), a)| (c, r, round_cents(a))).collect();
                    v.sort_by(|a, b| b.2.total_cmp(&a.2).then_with(|| a.1.cmp(&b.1)));
                    v
                },
                payers,
                no_payer_90d: round_cents(no_payer),
            }
        })
        .collect();
    projects.sort_by(|a, b| b.d90.total_cmp(&a.d90).then_with(|| a.project.cmp(&b.project)));

    let coverage = [("stripe", stripe), ("email", mail), ("bank", bank)]
        .into_iter()
        .map(|(source, d)| MoneyCoverage {
            source: source.to_string(),
            ok: is_ok(d),
            reason: d.get("reason").and_then(|v| v.as_str()).map(String::from),
            collected_at: jf64(d, "collected_at"),
            window_days: jf64(d, "window_days"),
        })
        .collect();

    let mut stripe_accounts = Vec::new();
    if is_ok(stripe) {
        if let Some(accounts) = stripe.get("accounts").and_then(|a| a.as_object()) {
            for (pid, a) in accounts {
                let sub = stripe.get("subscriptions").and_then(|s| s.get(pid));
                stripe_accounts.push(StripeAccount {
                    project: pid.clone(),
                    ok: is_ok(a),
                    error: a.get("error").and_then(|v| v.as_str()).map(String::from),
                    active: sub.and_then(|s| s.get("active")).and_then(|v| v.as_u64()).unwrap_or(0),
                    mrr: round_cents(sub.and_then(|s| jf64(s, "mrr")).unwrap_or(0.0)),
                });
            }
        }
    }

    let bank_accounts = if is_ok(bank) {
        jlist(bank, "accounts")
            .map(|a| BankAccount {
                name: jstr(a, "name"),
                org: jstr(a, "org"),
                project: jproject(a),
                balance: jf64(a, "balance"),
                currency: {
                    let c = jstr(a, "currency");
                    if c.is_empty() { "usd".to_string() } else { c }
                },
            })
            .collect()
    } else {
        vec![]
    };

    MoneyFinance { coverage, projects, stripe_accounts, bank_accounts }
}

fn jstr(v: &serde_json::Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}
fn jf64(v: &serde_json::Value, k: &str) -> Option<f64> {
    v.get(k).and_then(|x| x.as_f64())
}
fn jproject(v: &serde_json::Value) -> Option<String> {
    v.get("project").and_then(|x| x.as_str()).map(String::from)
}
fn jlist<'a>(v: &'a serde_json::Value, k: &str) -> impl Iterator<Item = &'a serde_json::Value> {
    v.get(k).and_then(|x| x.as_array()).into_iter().flatten()
}
fn is_ok(v: &serde_json::Value) -> bool {
    v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false)
}

#[allow(clippy::too_many_arguments)]
fn money_event(
    id: String, channel: &'static str, source: String, kind: &str, amount: f64,
    net: Option<f64>, currency: String, created: f64, payer: String, project: Option<String>,
) -> MoneyEvent {
    MoneyEvent {
        id, channel, source, kind: kind.to_string(), amount, net, currency, created, payer, project,
        dup_of: None, counted: false,
    }
}

fn money_normalize(stripe: &serde_json::Value, mail: &serde_json::Value, bank: &serde_json::Value) -> (Vec<MoneyEvent>, Vec<MoneyFlag>) {
    let mut ev = Vec::new();
    let mut flags = Vec::new();
    let currency = |v: &serde_json::Value| {
        let c = jstr(v, "currency");
        if c.is_empty() { "usd".to_string() } else { c }
    };
    if is_ok(stripe) {
        for c in jlist(stripe, "charges") {
            let (Some(amount), Some(created)) = (jf64(c, "amount"), jf64(c, "created")) else { continue };
            ev.push(money_event(jstr(c, "id"), "stripe", "stripe".into(), "payment", amount,
                jf64(c, "net"), currency(c), created, jstr(c, "payer"), jproject(c)));
        }
        for p in jlist(stripe, "payouts") {
            let Some(amount) = jf64(p, "amount") else { continue };
            let created = jf64(p, "arrival").or_else(|| jf64(p, "created")).unwrap_or(0.0);
            let status = jstr(p, "status");
            if status == "canceled" || status == "failed" {
                flags.push(MoneyFlag { kind: "payout failed", amount, created });
                continue;
            }
            ev.push(money_event(jstr(p, "id"), "stripe", "stripe".into(), "payout", amount, None,
                currency(p), created, String::new(), jproject(p)));
        }
        for c in jlist(stripe, "failed") {
            flags.push(MoneyFlag { kind: "failed", amount: jf64(c, "amount").unwrap_or(0.0), created: jf64(c, "created").unwrap_or(0.0) });
        }
        for r in jlist(stripe, "refunds") {
            flags.push(MoneyFlag { kind: "refund", amount: jf64(r, "amount").unwrap_or(0.0), created: jf64(r, "created").unwrap_or(0.0) });
        }
    }
    if is_ok(mail) {
        for m in jlist(mail, "items") {
            let (Some(amount), Some(created)) = (jf64(m, "amount"), jf64(m, "created")) else { continue };
            ev.push(money_event(format!("mail:{}", jstr(m, "id")), "email", jstr(m, "source"),
                &jstr(m, "kind"), amount, None, "usd".into(), created, jstr(m, "payer"), jproject(m)));
        }
    }
    if is_ok(bank) {
        for b in jlist(bank, "inflows") {
            let (Some(amount), Some(created)) = (jf64(b, "amount"), jf64(b, "created")) else { continue };
            let rail = jstr(b, "rail");
            ev.push(money_event(format!("bank:{}", jstr(b, "id")), "bank",
                if rail.is_empty() { "deposit".into() } else { rail }, "deposit", amount, None,
                currency(b), created, String::new(), jproject(b)));
        }
    }
    ev.sort_by(|a, b| a.created.total_cmp(&b.created));
    (ev, flags)
}

fn money_amount_match(primary: &MoneyEvent, secondary: &MoneyEvent, fee_ok: bool) -> bool {
    let (a, b) = (primary.amount, secondary.amount);
    (a - b).abs() < 0.011
        || primary.net.is_some_and(|n| (n - b).abs() < 0.011)
        || (fee_ok && a * 0.955 - 0.50 <= b && b < a)
}

fn money_within(primary: &MoneyEvent, secondary: &MoneyEvent, before_days: f64, after_days: f64) -> bool {
    let d = (secondary.created - primary.created) / DAY_SECS;
    -before_days <= d && d <= after_days
}

// Labels duplicates in place. `covered` = sources whose individual payments are already
// visible. A sighting absorbs at most one duplicate per channel and kind.
fn money_dedupe(events: &mut [MoneyEvent], covered: &std::collections::HashSet<String>) {
    let mut used: std::collections::HashSet<(String, &'static str, String)> = Default::default();

    fn find(events: &[MoneyEvent], used: &std::collections::HashSet<(String, &'static str, String)>,
            e: usize, cands: &[usize], before: f64, after: f64, fee_ok: bool) -> Option<usize> {
        cands.iter().copied().find(|&p| {
            p != e
                && events[p].dup_of.is_none()
                && !used.contains(&(events[p].id.clone(), events[e].channel, events[e].kind.clone()))
                && money_amount_match(&events[p], &events[e], fee_ok)
                && money_within(&events[p], &events[e], before, after)
        })
    }
    fn link(events: &mut [MoneyEvent], used: &mut std::collections::HashSet<(String, &'static str, String)>, dup: usize, prim: usize) {
        events[dup].dup_of = Some(events[prim].id.clone());
        used.insert((events[prim].id.clone(), events[dup].channel, events[dup].kind.clone()));
    }

    let idx = |ch: &str| -> Vec<usize> { (0..events.len()).filter(|&i| events[i].channel == ch).collect() };
    let (api, mail, bank) = (idx("stripe"), idx("email"), idx("bank"));

    // 1. Stripe emails vs the Stripe API (same object seen twice).
    for &e in &mail {
        if events[e].source == "stripe" {
            let cands: Vec<usize> = api.iter().copied().filter(|&a| events[a].kind == events[e].kind).collect();
            if let Some(p) = find(events, &used, e, &cands, 3.0, 3.0, false) {
                link(events, &mut used, e, p);
            }
        }
    }
    // 2. The same notification in two inboxes / two alerts for one Zelle.
    for (i, &e) in mail.iter().enumerate() {
        if events[e].dup_of.is_some() {
            continue;
        }
        for &p in &mail[..i] {
            let (pe, ee) = (&events[p], &events[e]);
            let zelle_bank = |s: &str| s == "zelle" || s == "bank";
            if pe.dup_of.is_none()
                && pe.kind == ee.kind
                && (pe.amount - ee.amount).abs() < 0.011
                && (pe.created - ee.created).abs() < 2.0 * DAY_SECS
                && ((zelle_bank(&pe.source) && zelle_bank(&ee.source)) || pe.source == ee.source)
                && (pe.payer.is_empty() || ee.payer.is_empty() || pe.payer.to_lowercase() == ee.payer.to_lowercase())
            {
                link(events, &mut used, e, p);
                break;
            }
        }
    }
    let payouts: Vec<usize> = api.iter().chain(&mail).copied()
        .filter(|&i| events[i].kind == "payout" && events[i].dup_of.is_none()).collect();
    // A bank's email about a platform deposit is a bank line that arrived by email.
    let landed: Vec<usize> = mail.iter().copied()
        .filter(|&i| events[i].kind == "deposit" && PAYOUT_RAILS.contains(&events[i].source.as_str()) && events[i].dup_of.is_none())
        .collect();
    let payments: Vec<usize> = mail.iter().copied()
        .filter(|&i| (events[i].kind == "payment" || events[i].kind == "deposit") && events[i].dup_of.is_none() && !landed.contains(&i))
        .collect();
    for e in landed.iter().chain(&bank).copied() {
        let src = events[e].source.clone();
        // 3. Bank line for a platform payout (arrives 0-5 days after).
        let rail_payouts: Vec<usize> = payouts.iter().copied()
            .filter(|&p| events[p].source == src || src == "ach" || src == "deposit").collect();
        if let Some(p) = find(events, &used, e, &rail_payouts, 1.0, 5.0, false) {
            link(events, &mut used, e, p);
            continue;
        }
        // 4. Bank line for an emailed payment (Zelle alert, bank deposit alert, PayPal...).
        let cands: Vec<usize> = payments.iter().copied()
            .filter(|&p| {
                let ps = events[p].source.as_str();
                ps == src || (["zelle", "bank", "quickbooks"].contains(&ps) && ["zelle", "ach", "deposit", "check"].contains(&src.as_str()))
            })
            .collect();
        if let Some(p) = find(events, &used, e, &cands, 1.0, 4.0, FEE_RAILS.contains(&src.as_str())) {
            link(events, &mut used, e, p);
            continue;
        }
        // 5. A Stripe charge paid out alone (no payout data): bank = net of fee.
        if src == "stripe" {
            let charges: Vec<usize> = api.iter().copied().filter(|&a| events[a].kind == "payment").collect();
            if let Some(p) = find(events, &used, e, &charges, 0.0, 7.0, true) {
                link(events, &mut used, e, p);
                continue;
            }
        }
        // 6. A platform cash-out whose individual payments are already counted.
        if PAYOUT_RAILS.contains(&src.as_str()) && covered.contains(&src) {
            events[e].dup_of = Some("source".to_string());
        }
    }
}

fn money_classify(events: &mut [MoneyEvent], covered: &std::collections::HashSet<String>) {
    for e in events.iter_mut().filter(|e| e.dup_of.is_none()) {
        e.counted = if e.kind == "payout" && covered.contains(&e.source) {
            false
        } else if e.kind == "payout" && e.currency == "usd" {
            true // the payout is the only record of that income
        } else if e.channel == "bank" && NOT_INCOME_RAILS.contains(&e.source.as_str()) {
            false
        } else {
            e.currency == "usd"
        };
    }
}

fn round_cents(v: f64) -> f64 {
    // + 0.0 turns the -0.0 of an empty f64 sum into 0.0
    (v * 100.0).round() / 100.0 + 0.0
}

fn build_money(stripe: &serde_json::Value, mail: &serde_json::Value, bank: &serde_json::Value, now: f64) -> MoneySummary {
    let (mut events, flags) = money_normalize(stripe, mail, bank);
    let mut covered = std::collections::HashSet::new();
    if is_ok(stripe) {
        covered.insert("stripe".to_string());
    }
    if is_ok(mail) {
        covered.extend(events.iter().filter(|e| e.channel == "email" && e.kind == "payment").map(|e| e.source.clone()));
    }
    money_dedupe(&mut events, &covered);
    money_classify(&mut events, &covered);

    let midnight = chrono::DateTime::from_timestamp(now as i64, 0)
        .map(|t| t.with_timezone(&chrono::Local).date_naive())
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .and_then(|d| d.and_local_timezone(chrono::Local).earliest())
        .map_or(now - DAY_SECS, |t| t.timestamp() as f64);
    let (d7, d30) = (now - 7.0 * DAY_SECS, now - 30.0 * DAY_SECS);
    let counted: Vec<&MoneyEvent> = events.iter().filter(|e| e.counted).collect();
    let sum_since = |s: f64| round_cents(counted.iter().filter(|e| e.created >= s).map(|e| e.amount).sum());
    let count_since = |s: f64| counted.iter().filter(|e| e.created >= s).count();
    let recent_flags: Vec<&MoneyFlag> = flags.iter().filter(|f| f.created >= d30).collect();
    let mrr_total = if is_ok(stripe) {
        stripe.get("subscriptions").and_then(|s| s.as_object()).map_or(0.0, |subs| {
            subs.values()
                .filter(|s| s.get("active").and_then(|v| v.as_f64()).unwrap_or(0.0) > 0.0)
                .map(|s| s.get("mrr").and_then(|v| v.as_f64()).unwrap_or(0.0))
                .sum()
        })
    } else {
        0.0
    };
    let sources: HashMap<String, MoneySource> = [("stripe", stripe), ("email", mail), ("bank", bank)]
        .into_iter()
        .map(|(k, d)| (k.to_string(), MoneySource { ok: is_ok(d) }))
        .collect();

    MoneySummary {
        configured: sources.values().any(|s| s.ok),
        sources,
        totals: MoneyTotals { today: sum_since(midnight), d7: sum_since(d7), d30: sum_since(d30) },
        counts: [("today", count_since(midnight)), ("d7", count_since(d7)), ("d30", count_since(d30))]
            .into_iter().map(|(k, v)| (k.to_string(), v)).collect(),
        failed_30d: recent_flags.iter().filter(|f| f.kind == "failed").count(),
        refunds_30d: round_cents(recent_flags.iter().filter(|f| f.kind == "refund").map(|f| f.amount).sum()),
        mrr_total: round_cents(mrr_total),
        finance: money_finance(&counted, stripe, mail, bank, now),
    }
}

// ==========================================
// Auto-Launch Management (macOS)
// ==========================================

const LAUNCH_AGENT_PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pulse.autolaunch</string>
    <key>ProgramArguments</key>
    <array>
        <string>open</string>
        <string>-a</string>
        <string>Pulse</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>7</integer>
        <key>Minute</key>
        <integer>30</integer>
    </dict>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>"#;

fn get_launch_agent_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join("Library/LaunchAgents/com.pulse.autolaunch.plist"))
}

#[tauri::command]
fn get_auto_launch_enabled() -> bool {
    get_launch_agent_path()
        .map(|path| path.exists())
        .unwrap_or(false)
}

#[tauri::command]
fn set_auto_launch_enabled(enabled: bool) -> Result<(), String> {
    let plist_path = get_launch_agent_path()
        .ok_or_else(|| "Could not determine home directory".to_string())?;

    if enabled {
        // Create LaunchAgents directory if needed
        if let Some(parent) = plist_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create LaunchAgents directory: {}", e))?;
        }

        // Write the plist file
        fs::write(&plist_path, LAUNCH_AGENT_PLIST)
            .map_err(|e| format!("Failed to write launch agent: {}", e))?;

        // Load the launch agent
        std::process::Command::new("launchctl")
            .args(["load", plist_path.to_str().unwrap()])
            .output()
            .map_err(|e| format!("Failed to load launch agent: {}", e))?;
    } else {
        if plist_path.exists() {
            // Unload the launch agent first
            let _ = std::process::Command::new("launchctl")
                .args(["unload", plist_path.to_str().unwrap()])
                .output();

            // Delete the plist file
            fs::remove_file(&plist_path)
                .map_err(|e| format!("Failed to remove launch agent: {}", e))?;
        }
    }

    Ok(())
}

// ==========================================
// Tauri App Entry Point
// ==========================================

// ==========================================
// Menu bar item: decisions waiting on the owner, and a way back in
// ==========================================

const TRAY_ID: &str = "pulse";

// The count beside the menu bar mark; nothing when the queue is empty.
fn tray_title(count: u32) -> Option<String> {
    (count > 0).then(|| count.to_string())
}

fn tray_tooltip(count: u32) -> String {
    match count {
        0 => "Pulse: no decisions waiting".to_string(),
        1 => "Pulse: 1 decision needs you".to_string(),
        n => format!("Pulse: {} decisions need you", n),
    }
}

// The webview computes the count from the same data as Today and sends it here.
#[tauri::command]
fn set_tray_count(app: AppHandle, count: u32) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY_ID).ok_or("menu bar item not created")?;
    tray.set_title(tray_title(count)).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tray_tooltip(count))).map_err(|e| e.to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open Pulse", true, None::<&str>)?;
            let today = MenuItem::with_id(app, "today", "Today", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Pulse", true, Some("CmdOrCtrl+Q"))?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &today, &separator, &quit])?;

            // A template image: macOS tints it for light and dark menu bars.
            let icon = Image::from_bytes(include_bytes!("../icons/tray-template@2x.png"))?;
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(icon)
                .icon_as_template(true)
                .tooltip(tray_tooltip(0))
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "today" => {
                        show_main_window(app);
                        let _ = app.emit("pulse://navigate", "today");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        // Closing the window keeps Pulse in the menu bar; Quit (menu or Cmd+Q) exits.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_history,
            save_snapshot,
            fetch_app_metrics,
            start_google_oauth,
            refresh_google_token,
            fetch_google_calendar,
            fetch_gmail,
            fetch_github_metrics,
            get_auto_launch_enabled,
            set_auto_launch_enabled,
            read_portfolio,
            set_tv_fullscreen,
            read_tracker,
            set_tray_count
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        // Clicking the Dock icon brings the hidden window back.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_main_window(app);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}

#[cfg(test)]
mod tray_tests {
    use super::*;

    #[test]
    fn titles_and_tooltips_count_decisions() {
        assert_eq!(tray_title(0), None);
        assert_eq!(tray_title(7).as_deref(), Some("7"));
        assert_eq!(tray_tooltip(0), "Pulse: no decisions waiting");
        assert_eq!(tray_tooltip(1), "Pulse: 1 decision needs you");
        assert_eq!(tray_tooltip(22), "Pulse: 22 decisions need you");
    }
}

#[cfg(test)]
mod portfolio_tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pulse-portfolio-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("companies/acme")).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn rejects_paths_outside_root() {
        let root = temp_root("escape");
        assert!(resolve_portfolio_file(&root, "../", "status.json").is_err());
        assert!(resolve_portfolio_file(&root, "/etc", "passwd").is_err());
        assert!(resolve_portfolio_file(&root, "companies/../../", "status.json").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reports_missing_and_malformed_status() {
        let root = temp_root("malformed");
        assert_eq!(resolve_portfolio_file(&root, "companies/acme", "status.json").unwrap_err(), "missing");

        let path = root.join("companies/acme/status.json");
        fs::write(&path, "{ not json").unwrap();
        let resolved = resolve_portfolio_file(&root, "companies/acme", "status.json").unwrap();
        assert!(read_portfolio_json(&resolved).unwrap_err().starts_with("malformed"));

        fs::write(&path, r#"{"entity":"acme","health":"green"}"#).unwrap();
        assert_eq!(read_portfolio_json(&resolved).unwrap()["health"], "green");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn encodes_base64() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn reads_logos_only_from_assets() {
        let root = temp_root("logos");
        fs::create_dir_all(root.join("assets/logos")).unwrap();
        fs::write(root.join("assets/logos/acme.svg"), "<svg/>").unwrap();
        fs::write(root.join("companies/acme/logo.svg"), "<svg/>").unwrap();
        fs::write(root.join("assets/logos/notes.txt"), "x").unwrap();
        assert_eq!(read_portfolio_logo(&root, "assets/logos/acme.svg").unwrap(), "data:image/svg+xml;base64,PHN2Zy8+");
        assert!(read_portfolio_logo(&root, "companies/acme/logo.svg").is_err());
        assert!(read_portfolio_logo(&root, "assets/logos/notes.txt").is_err());
        assert!(read_portfolio_logo(&root, "assets/../companies/acme/logo.svg").is_err());
        assert!(read_portfolio_logo(&root, "/etc/hosts.svg").is_err());
        assert!(read_portfolio_logo(&root, "assets/logos/missing.png").unwrap_err().ends_with("missing"));
        // A symlink inside assets/ that points elsewhere in the root is refused too.
        std::os::unix::fs::symlink(root.join("companies/acme/logo.svg"), root.join("assets/logos/link.svg")).unwrap();
        assert!(read_portfolio_logo(&root, "assets/logos/link.svg").is_err());
        let _ = fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod tracker_tests {
    use super::*;
    use serde_json::json;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pulse-tracker-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("data")).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn reads_only_allowlisted_files() {
        let root = temp_root("allow");
        fs::write(root.join("data/tasks.json"), r#"{"tasks":{}}"#).unwrap();
        fs::write(root.join("notes.json"), r#"{"notes":{}}"#).unwrap();
        fs::write(root.join("todos.json"), "[]").unwrap();
        fs::write(root.join("accounts.json"), "{}").unwrap();
        fs::write(root.join("data/accounts.json"), "{}").unwrap();

        assert!(resolve_tracker_file(&root, "tasks.json").is_ok());
        assert!(resolve_tracker_file(&root, "notes.json").is_ok());
        assert_eq!(resolve_tracker_file(&root, "email.json").unwrap_err(), "missing");
        for name in ["todos.json", "accounts.json", "../tasks.json", "data/tasks.json", "/etc/passwd", ""] {
            assert_eq!(resolve_tracker_file(&root, name).unwrap_err(), "not an allowed tracker file", "{}", name);
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_symlinks_that_escape() {
        let root = temp_root("symlink");
        let outside = temp_root("symlink-outside");
        fs::write(outside.join("secret.json"), r#"{"token":"x"}"#).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.json"), root.join("data/email.json")).unwrap();
        // A data file pointing at the root-level copy is outside data/ too.
        fs::write(root.join("scan.json"), "{}").unwrap();
        std::os::unix::fs::symlink(root.join("scan.json"), root.join("data/scan.json")).unwrap();

        assert_eq!(resolve_tracker_file(&root, "email.json").unwrap_err(), "path is outside ~/project-tracker");
        assert_eq!(resolve_tracker_file(&root, "scan.json").unwrap_err(), "path is outside ~/project-tracker");
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn drops_closed_tasks_and_email_bodies() {
        let tasks = json!({"tasks": {
            "a": {"id": "a", "title": "Decide: price", "status": "open", "urgency": "now", "evidence": {"type": "manual"}},
            "b": {"id": "b", "title": "Old", "status": "done"},
            "c": {"id": "c", "title": "Later", "status": "scheduled", "show_from": "2026-11-06"},
            "d": {"id": "d", "title": "Gone", "status": "stale"}
        }});
        let out = serde_json::to_value(tracker_tasks(&tasks)).unwrap();
        let ids: Vec<&str> = out.as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["a", "c"]);
        assert!(out[0].get("evidence").is_none());

        let email = json!({"stale": false, "replied_to": ["x@y.z"], "accounts": {"v": {"label": "Acme", "ok": false}},
            "needs_reply": [{"subject": "Hi", "sender": "a@b.c", "snippet": "private body", "message_id": "m"}]});
        let out = serde_json::to_value(tracker_email(&email)).unwrap();
        assert_eq!(out["needs_reply"][0]["subject"], "Hi");
        assert!(out["needs_reply"][0].get("snippet").is_none());
        assert!(out["needs_reply"][0].get("message_id").is_none());
        assert_eq!(out["replied_count"], 1);
        assert_eq!(out["accounts_not_fetching"][0], "Acme");
    }

    // Same fixture as `python3 money.py --test`, so both report identical totals.
    #[test]
    fn money_matches_python_fixture() {
        use chrono::TimeZone;
        let now = chrono::Local.with_ymd_and_hms(2026, 10, 25, 15, 0, 0).unwrap().timestamp() as f64;
        let t = |days_ago: f64| now - days_ago * DAY_SECS;
        let stripe = json!({"ok": true, "collected_at": now, "accounts": {"northwind": {"ok": true}},
            "charges": [
                {"id": "ch_a", "amount": 120.0, "fee": 3.78, "net": 116.22, "created": t(6.0), "project": "northwind", "payer": "Ana", "currency": "usd"},
                {"id": "ch_b", "amount": 1000.0, "fee": null, "net": null, "created": t(0.0), "project": "northwind", "payer": "Ben", "currency": "usd"}],
            "payouts": [{"id": "po_a", "amount": 116.22, "status": "paid", "created": t(6.0), "arrival": t(4.0), "project": "northwind"}],
            "failed": [{"id": "ch_f", "amount": 50.0, "created": t(2.0), "project": "northwind"}],
            "refunds": [{"id": "re_1", "amount": 20.0, "created": t(1.0), "project": "northwind"}],
            "subscriptions": {"northwind": {"active": 3, "mrr": 40.0}}});
        let mail = json!({"ok": true, "collected_at": now, "items": [
            {"id": "m1", "source": "stripe", "kind": "payout", "amount": 116.22, "created": t(5.0), "payer": "", "project": "northwind"},
            {"id": "m2", "source": "zelle", "kind": "payment", "amount": 350.0, "created": t(3.0), "payer": "CARLA", "project": null},
            {"id": "m3", "source": "venmo", "kind": "payment", "amount": 25.0, "created": t(10.0), "payer": "Dee", "project": null},
            {"id": "m2b", "source": "zelle", "kind": "payment", "amount": 350.0, "created": t(3.0) + 60.0, "payer": "CARLA", "project": null},
            {"id": "m4", "source": "paypal", "kind": "payment", "amount": 200.0, "created": t(8.0), "payer": "Eve", "project": "acme"},
            {"id": "m5", "source": "stripe", "kind": "deposit", "amount": 116.22, "created": t(3.0) + 300.0, "payer": "", "project": "northwind"}]});
        let bank = json!({"ok": true, "collected_at": now, "inflows": [
            {"id": "b1", "amount": 116.22, "rail": "stripe", "created": t(3.0), "project": "northwind"},
            {"id": "b2", "amount": 350.0, "rail": "zelle", "created": t(2.0)},
            {"id": "b3", "amount": 500.0, "rail": "transfer", "created": t(1.0)},
            {"id": "b4", "amount": 80.0, "rail": "check", "created": t(1.0)},
            {"id": "b5", "amount": 25.0, "rail": "venmo", "created": t(9.0)},
            {"id": "b6", "amount": 193.90, "rail": "paypal", "created": t(7.0)}]});

        let m = build_money(&stripe, &mail, &bank, now);
        assert_eq!(m.totals, MoneyTotals { today: 1000.0, d7: 1550.0, d30: 1775.0 });
        assert_eq!((m.failed_30d, m.refunds_30d, m.mrr_total), (1, 20.0, 40.0));

        let off = json!({"ok": false, "reason": "not configured"});
        let no_api = build_money(&off, &json!({"ok": true, "items": [mail["items"][0]]}), &json!({"ok": false}), now);
        assert_eq!(no_api.totals.d30, 116.22);

        // Breakdowns add up to the totals and keep payers per project.
        let f = &m.finance;
        let northwind = f.projects.iter().find(|p| p.project == "northwind").unwrap();
        assert_eq!((northwind.d30, northwind.d90), (1120.0, 1120.0));
        assert_eq!(northwind.by_channel, vec![("stripe".to_string(), 1120.0)]);
        assert_eq!(northwind.payers[0], PayerTotal { name: "Ben".into(), total: 1000.0, payments: 1 });
        let d30: f64 = f.projects.iter().map(|p| p.d30).sum();
        assert!((d30 - m.totals.d30).abs() < 0.001);
        let months: f64 = f.projects.iter().flat_map(|p| p.months.iter().map(|(_, v)| v)).sum();
        assert!((months - 1775.0).abs() < 0.001);
        let unsorted = f.projects.iter().find(|p| p.project == "unsorted").unwrap();
        // CARLA's two Zelle alerts are one payment; the check deposit has no payer.
        assert_eq!(unsorted.payers.iter().find(|p| p.name == "CARLA").unwrap().payments, 1);
        assert_eq!(unsorted.no_payer_90d, 80.0);
        assert_eq!((f.stripe_accounts[0].project.as_str(), f.stripe_accounts[0].active, f.stripe_accounts[0].mrr), ("northwind", 3, 40.0));
        assert!(f.coverage.iter().all(|c| c.ok));

        let empty = build_money(&off, &json!({}), &off, now);
        assert!(empty.finance.projects.is_empty() && empty.finance.stripe_accounts.is_empty());
        assert_eq!(empty.finance.coverage[0].reason.as_deref(), Some("not configured"));
        assert!(!empty.configured);
        assert_eq!(empty.totals.d30, 0.0);
    }
}
