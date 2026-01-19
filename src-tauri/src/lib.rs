use chrono::{Datelike, Timelike};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
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

// TODO: Users should provide their own Google OAuth credentials
// Create a project at https://console.cloud.google.com and enable the Calendar API
// Then create OAuth 2.0 credentials and replace these placeholder values
const GOOGLE_CLIENT_ID: &str = "YOUR_GOOGLE_CLIENT_ID";
const GOOGLE_CLIENT_SECRET: &str = "YOUR_GOOGLE_CLIENT_SECRET";

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

    // Bind to a random available port on localhost
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind: {}", e))?;

    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get local addr: {}", e))?
        .port();

    let redirect_uri = format!("http://127.0.0.1:{}", port);
    let scopes = "https://www.googleapis.com/auth/calendar.readonly";

    // Build the auth URL
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent",
        GOOGLE_CLIENT_ID,
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
        ("client_id", GOOGLE_CLIENT_ID),
        ("client_secret", GOOGLE_CLIENT_SECRET),
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
    let client = reqwest::Client::new();

    let params = [
        ("client_id", GOOGLE_CLIENT_ID),
        ("client_secret", GOOGLE_CLIENT_SECRET),
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
// Tauri App Entry Point
// ==========================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Create tray menu
            let quit = MenuItem::with_id(app, "quit", "Quit Pulse", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Dashboard", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_history,
            save_snapshot,
            fetch_app_metrics,
            start_google_oauth,
            refresh_google_token,
            fetch_google_calendar
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
