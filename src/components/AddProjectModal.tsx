import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../contexts/ThemeContext';
import { App, IntegrationType, PROJECT_COLORS, Platform } from '../types';
import { Icon, CheckIcon, CloseIcon } from './Icons';
import { isRecommendedForPlatforms, getDefaultPlatformForIntegration } from '../utils/platforms';

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (app: App) => void;
}

type Step = 'type' | 'integrations' | 'configure';

const PLATFORM_OPTIONS: { id: Platform; label: string; icon: string; description: string }[] = [
  { id: 'web', label: 'Web App', icon: 'globe', description: 'SaaS, website, or web platform' },
  { id: 'mobile', label: 'Mobile App', icon: 'mobile', description: 'iOS, Android, or cross-platform' },
  { id: 'service', label: 'Service', icon: 'server', description: 'Agency, consulting, or freelance' },
  { id: 'fun', label: 'Fun Project', icon: 'rocket', description: 'Side project or experiment' },
];

type IntegrationCategory = 'payments' | 'analytics' | 'hosting' | 'database' | 'auth' | 'email' | 'monitoring' | 'calendar' | 'communication' | 'support';

const INTEGRATION_CATEGORIES: { id: IntegrationCategory; label: string }[] = [
  { id: 'payments', label: 'Payments & Revenue' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'hosting', label: 'Hosting & Deployment' },
  { id: 'database', label: 'Database & Backend' },
  { id: 'auth', label: 'Authentication' },
  { id: 'email', label: 'Email & Marketing' },
  { id: 'monitoring', label: 'Monitoring & Errors' },
  { id: 'calendar', label: 'Calendar & Scheduling' },
  { id: 'communication', label: 'Communication' },
  { id: 'support', label: 'Customer Support' },
];

// Service logo URLs - using official domains for favicon fetching
const SERVICE_LOGOS: Record<string, string> = {
  stripe: 'stripe.com',
  lemonsqueezy: 'lemonsqueezy.com',
  paddle: 'paddle.com',
  revenuecat: 'revenuecat.com',
  gumroad: 'gumroad.com',
  posthog: 'posthog.com',
  mixpanel: 'mixpanel.com',
  amplitude: 'amplitude.com',
  plausible: 'plausible.io',
  google_analytics: 'analytics.google.com',
  vercel: 'vercel.com',
  netlify: 'netlify.com',
  railway: 'railway.app',
  render: 'render.com',
  flyio: 'fly.io',
  supabase: 'supabase.com',
  firebase: 'firebase.google.com',
  planetscale: 'planetscale.com',
  neon: 'neon.tech',
  mongodb: 'mongodb.com',
  clerk: 'clerk.com',
  auth0: 'auth0.com',
  resend: 'resend.com',
  sendgrid: 'sendgrid.com',
  convertkit: 'convertkit.com',
  mailchimp: 'mailchimp.com',
  sentry: 'sentry.io',
  logrocket: 'logrocket.com',
  google_calendar: 'calendar.google.com',
  cal: 'cal.com',
  slack: 'slack.com',
  discord: 'discord.com',
  intercom: 'intercom.com',
  crisp: 'crisp.chat',
};

function getServiceLogo(serviceId: string): string {
  const domain = SERVICE_LOGOS[serviceId];
  if (domain) {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  }
  return '';
}

const INTEGRATIONS: { id: IntegrationType; label: string; icon: string; description: string; category: IntegrationCategory }[] = [
  // Payments & Revenue
  { id: 'stripe', label: 'Stripe', icon: 'credit-card', description: 'Payment processing & subscriptions', category: 'payments' },
  { id: 'lemonsqueezy', label: 'LemonSqueezy', icon: 'credit-card', description: 'Merchant of record for SaaS', category: 'payments' },
  { id: 'paddle', label: 'Paddle', icon: 'credit-card', description: 'Subscription billing & payments', category: 'payments' },
  { id: 'revenuecat', label: 'RevenueCat', icon: 'mobile', description: 'Mobile subscription management', category: 'payments' },
  { id: 'gumroad', label: 'Gumroad', icon: 'revenue', description: 'Sell digital products', category: 'payments' },
  // Analytics
  { id: 'posthog', label: 'PostHog', icon: 'analytics', description: 'Product analytics & feature flags', category: 'analytics' },
  { id: 'mixpanel', label: 'Mixpanel', icon: 'analytics', description: 'User behavior analytics', category: 'analytics' },
  { id: 'amplitude', label: 'Amplitude', icon: 'trending-up', description: 'Product intelligence platform', category: 'analytics' },
  { id: 'plausible', label: 'Plausible', icon: 'eye', description: 'Privacy-friendly web analytics', category: 'analytics' },
  { id: 'google_analytics', label: 'Google Analytics', icon: 'analytics', description: 'Web traffic analytics', category: 'analytics' },
  // Hosting & Deployment
  { id: 'vercel', label: 'Vercel', icon: 'triangle', description: 'Frontend deployment platform', category: 'hosting' },
  { id: 'netlify', label: 'Netlify', icon: 'diamond', description: 'Web hosting & serverless', category: 'hosting' },
  { id: 'railway', label: 'Railway', icon: 'server', description: 'Deploy apps in minutes', category: 'hosting' },
  { id: 'render', label: 'Render', icon: 'cloud', description: 'Cloud hosting platform', category: 'hosting' },
  { id: 'flyio', label: 'Fly.io', icon: 'globe', description: 'Deploy apps globally', category: 'hosting' },
  // Database & Backend
  { id: 'supabase', label: 'Supabase', icon: 'database', description: 'Postgres database & auth', category: 'database' },
  { id: 'firebase', label: 'Firebase', icon: 'database', description: 'Google backend platform', category: 'database' },
  { id: 'planetscale', label: 'PlanetScale', icon: 'database', description: 'Serverless MySQL platform', category: 'database' },
  { id: 'neon', label: 'Neon', icon: 'database', description: 'Serverless Postgres', category: 'database' },
  { id: 'mongodb', label: 'MongoDB Atlas', icon: 'database', description: 'Document database cloud', category: 'database' },
  // Auth
  { id: 'clerk', label: 'Clerk', icon: 'lock', description: 'User authentication & management', category: 'auth' },
  { id: 'auth0', label: 'Auth0', icon: 'lock', description: 'Identity management platform', category: 'auth' },
  // Email & Marketing
  { id: 'resend', label: 'Resend', icon: 'mail', description: 'Email API for developers', category: 'email' },
  { id: 'sendgrid', label: 'SendGrid', icon: 'mail', description: 'Email delivery service', category: 'email' },
  { id: 'convertkit', label: 'ConvertKit', icon: 'mail', description: 'Email marketing for creators', category: 'email' },
  { id: 'mailchimp', label: 'Mailchimp', icon: 'mail', description: 'Email marketing platform', category: 'email' },
  // Monitoring & Errors
  { id: 'sentry', label: 'Sentry', icon: 'alert', description: 'Error tracking & monitoring', category: 'monitoring' },
  { id: 'logrocket', label: 'LogRocket', icon: 'rocket', description: 'Session replay & monitoring', category: 'monitoring' },
  // Calendar & Scheduling
  { id: 'google_calendar', label: 'Google Calendar', icon: 'calendar', description: 'Calendar & events', category: 'calendar' },
  { id: 'cal', label: 'Cal.com', icon: 'calendar', description: 'Open source scheduling', category: 'calendar' },
  // Communication
  { id: 'slack', label: 'Slack', icon: 'activity', description: 'Team notifications & alerts', category: 'communication' },
  { id: 'discord', label: 'Discord', icon: 'users', description: 'Community notifications', category: 'communication' },
  // Support
  { id: 'intercom', label: 'Intercom', icon: 'user', description: 'Customer messaging platform', category: 'support' },
  { id: 'crisp', label: 'Crisp', icon: 'activity', description: 'Customer support chat', category: 'support' },
];


export function AddProjectModal({ isOpen, onClose, onComplete }: AddProjectModalProps) {
  const { tokens } = useTheme();
  const [step, setStep] = useState<Step>('type');
  const [projectName, setProjectName] = useState('');
  const [projectDomain, setProjectDomain] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([]);
  const [selectedColor, setSelectedColor] = useState(PROJECT_COLORS[0].value);
  const [selectedIntegrations, setSelectedIntegrations] = useState<IntegrationType[]>([]);
  const [apiKeys, setApiKeys] = useState<Record<IntegrationType, { apiKey: string; projectId?: string; teamId?: string }>>({} as any);

  const resetForm = () => {
    setStep('type');
    setProjectName('');
    setProjectDomain('');
    setSelectedPlatforms([]);
    setSelectedColor(PROJECT_COLORS[0].value);
    setSelectedIntegrations([]);
    setApiKeys({} as any);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Toggle platform selection (multi-select)
  const togglePlatform = (platform: Platform) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  // Check if integration is recommended for any selected platform
  const isRecommended = (integrationId: IntegrationType): boolean => {
    return isRecommendedForPlatforms(integrationId, selectedPlatforms);
  };

  const handleComplete = () => {
    const newApp: App = {
      id: crypto.randomUUID(),
      name: projectName || 'New Project',
      domain: projectDomain || undefined,
      color: selectedColor,
      platforms: selectedPlatforms,
      integrations: selectedIntegrations.map(type => ({
        type,
        apiKey: apiKeys[type]?.apiKey,
        projectId: apiKeys[type]?.projectId,
        teamId: apiKeys[type]?.teamId,
        enabled: !!apiKeys[type]?.apiKey,
        platform: getDefaultPlatformForIntegration(type),
      })),
    };
    onComplete(newApp);
    handleClose();
  };

  const toggleIntegration = (id: IntegrationType) => {
    setSelectedIntegrations(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: tokens.colors.bgElevated,
            border: `1px solid ${tokens.colors.border}`,
            borderRadius: tokens.radius.xl,
            width: '90%',
            maxWidth: '600px',
            maxHeight: '85vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '24px',
              borderBottom: `1px solid ${tokens.colors.border}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                Add New Project
              </h2>
              <p style={{ fontSize: '13px', color: tokens.colors.textMuted }}>
                {step === 'type' && 'What kind of project are you building?'}
                {step === 'integrations' && 'Select your integrations'}
                {step === 'configure' && 'Connect your accounts'}
              </p>
            </div>
            <button
              onClick={handleClose}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: tokens.radius.sm,
                border: `1px solid ${tokens.colors.border}`,
                background: 'transparent',
                color: tokens.colors.textMuted,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CloseIcon size={16} />
            </button>
          </div>

          {/* Progress Indicator */}
          <div style={{ padding: '16px 24px', display: 'flex', gap: '8px' }}>
            {['type', 'integrations', 'configure'].map((s, i) => (
              <div
                key={s}
                style={{
                  flex: 1,
                  height: '4px',
                  borderRadius: '2px',
                  background: ['type', 'integrations', 'configure'].indexOf(step) >= i
                    ? tokens.colors.accent
                    : tokens.colors.border,
                  transition: 'background 0.2s ease',
                }}
              />
            ))}
          </div>

          {/* Content */}
          <div style={{ padding: '24px', flex: 1, overflow: 'auto' }}>
            {/* Step 1: Project Type */}
            {step === 'type' && (
              <div>
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', fontSize: '13px', color: tokens.colors.textMuted, marginBottom: '8px' }}>
                    Project Name
                  </label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="My Awesome Project"
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: tokens.colors.bgCard,
                      border: `1px solid ${tokens.colors.border}`,
                      borderRadius: tokens.radius.sm,
                      color: tokens.colors.text,
                      fontSize: '14px',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', fontSize: '13px', color: tokens.colors.textMuted, marginBottom: '8px' }}>
                    Platforms <span style={{ color: tokens.colors.textDim }}>(select all that apply)</span>
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    {PLATFORM_OPTIONS.map((platform) => {
                      const isSelected = selectedPlatforms.includes(platform.id);
                      return (
                        <button
                          key={platform.id}
                          onClick={() => togglePlatform(platform.id)}
                          style={{
                            padding: '16px',
                            background: isSelected ? tokens.colors.accentGlow : tokens.colors.bgCard,
                            border: `1px solid ${isSelected ? tokens.colors.accent : tokens.colors.border}`,
                            borderRadius: tokens.radius.md,
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.15s ease',
                            position: 'relative',
                          }}
                        >
                          {isSelected && (
                            <div
                              style={{
                                position: 'absolute',
                                top: '8px',
                                right: '8px',
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                background: tokens.colors.accent,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <CheckIcon size={12} color="white" />
                            </div>
                          )}
                          <div style={{ marginBottom: '8px' }}>
                            <Icon name={platform.icon} size={24} color={isSelected ? tokens.colors.accent : tokens.colors.textMuted} />
                          </div>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: tokens.colors.text, marginBottom: '4px' }}>
                            {platform.label}
                          </div>
                          <div style={{ fontSize: '12px', color: tokens.colors.textMuted }}>
                            {platform.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', fontSize: '13px', color: tokens.colors.textMuted, marginBottom: '8px' }}>
                    Project Color
                  </label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {PROJECT_COLORS.map((color) => (
                      <button
                        key={color.value}
                        onClick={() => setSelectedColor(color.value)}
                        title={color.name}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: tokens.radius.sm,
                          background: color.value,
                          border: selectedColor === color.value ? '3px solid white' : '3px solid transparent',
                          cursor: 'pointer',
                          boxShadow: selectedColor === color.value ? `0 0 0 2px ${color.value}` : 'none',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Integrations */}
            {step === 'integrations' && (
              <div>
                <p style={{ fontSize: '13px', color: tokens.colors.textMuted, marginBottom: '16px' }}>
                  Based on your selected platforms ({selectedPlatforms.map(p => PLATFORM_OPTIONS.find(o => o.id === p)?.label).join(', ')}), we recommend these integrations. Select what you need:
                </p>

                {/* Selected count */}
                {selectedIntegrations.length > 0 && (
                  <div style={{
                    padding: '8px 12px',
                    background: tokens.colors.accentGlow,
                    borderRadius: tokens.radius.sm,
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: tokens.colors.accent,
                  }}>
                    {selectedIntegrations.length} integration{selectedIntegrations.length !== 1 ? 's' : ''} selected
                  </div>
                )}

                {/* Integrations grouped by category */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {INTEGRATION_CATEGORIES.map((category) => {
                    const categoryIntegrations = INTEGRATIONS.filter(i => i.category === category.id);
                    if (categoryIntegrations.length === 0) return null;

                    return (
                      <div key={category.id}>
                        <h4 style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: tokens.colors.textMuted,
                          marginBottom: '10px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}>
                          {category.label}
                        </h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          {categoryIntegrations.map((integration) => {
                            const recommended = isRecommended(integration.id);
                            const selected = selectedIntegrations.includes(integration.id);

                            return (
                              <button
                                key={integration.id}
                                onClick={() => toggleIntegration(integration.id)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px',
                                  padding: '10px 12px',
                                  background: selected ? tokens.colors.accentGlow : tokens.colors.bgCard,
                                  border: `1px solid ${selected ? tokens.colors.accent : tokens.colors.border}`,
                                  borderRadius: tokens.radius.sm,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                <img
                                  src={getServiceLogo(integration.id)}
                                  alt=""
                                  style={{
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '4px',
                                    objectFit: 'contain',
                                  }}
                                  onError={(e) => {
                                    // Fallback to generic icon on error
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{
                                    fontSize: '13px',
                                    fontWeight: 500,
                                    color: tokens.colors.text,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                  }}>
                                    {integration.label}
                                    {recommended && (
                                      <span style={{
                                        width: '6px',
                                        height: '6px',
                                        borderRadius: '50%',
                                        background: tokens.colors.success,
                                      }} title="Recommended" />
                                    )}
                                  </div>
                                </div>
                                <div
                                  style={{
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '4px',
                                    border: `2px solid ${selected ? tokens.colors.accent : tokens.colors.border}`,
                                    background: selected ? tokens.colors.accent : 'transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'white',
                                    fontSize: '11px',
                                    flexShrink: 0,
                                  }}
                                >
                                  {selected && <CheckIcon size={12} color="white" />}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p style={{ fontSize: '11px', color: tokens.colors.textDim, marginTop: '16px' }}>
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: tokens.colors.success,
                    display: 'inline-block',
                    marginRight: '6px',
                  }} />
                  Green dot = recommended for your project type. You can add more integrations later in Settings.
                </p>
              </div>
            )}

            {/* Step 3: Configure */}
            {step === 'configure' && (
              <div>
                {selectedIntegrations.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: tokens.colors.textMuted }}>
                    <p style={{ marginBottom: '8px' }}>No integrations selected.</p>
                    <p style={{ fontSize: '13px' }}>You can add integrations later in Settings.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {selectedIntegrations.map((intId) => {
                      const integration = INTEGRATIONS.find(i => i.id === intId)!;
                      return (
                        <div
                          key={intId}
                          style={{
                            padding: '20px',
                            background: tokens.colors.bgCard,
                            border: `1px solid ${tokens.colors.border}`,
                            borderRadius: tokens.radius.md,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                            <img
                              src={getServiceLogo(integration.id)}
                              alt=""
                              style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '6px',
                                objectFit: 'contain',
                              }}
                            />
                            <span style={{ fontSize: '14px', fontWeight: 500, color: tokens.colors.text }}>
                              {integration.label}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                              <label style={{ display: 'block', fontSize: '12px', color: tokens.colors.textDim, marginBottom: '6px' }}>
                                API Key
                              </label>
                              <input
                                type="password"
                                value={apiKeys[intId]?.apiKey || ''}
                                onChange={(e) => setApiKeys(prev => ({
                                  ...prev,
                                  [intId]: { ...prev[intId], apiKey: e.target.value }
                                }))}
                                placeholder={`Enter your ${integration.label} API key`}
                                style={{
                                  width: '100%',
                                  padding: '10px 12px',
                                  background: tokens.colors.bg,
                                  border: `1px solid ${tokens.colors.border}`,
                                  borderRadius: tokens.radius.sm,
                                  color: tokens.colors.text,
                                  fontSize: '13px',
                                  fontFamily: 'inherit',
                                  outline: 'none',
                                }}
                              />
                            </div>
                            {(intId === 'vercel' || intId === 'supabase' || intId === 'posthog') && (
                              <div>
                                <label style={{ display: 'block', fontSize: '12px', color: tokens.colors.textDim, marginBottom: '6px' }}>
                                  {intId === 'vercel' ? 'Project Name or ID' : intId === 'supabase' ? 'Project Ref' : 'Project ID'}
                                </label>
                                <input
                                  type="text"
                                  value={apiKeys[intId]?.projectId || ''}
                                  onChange={(e) => setApiKeys(prev => ({
                                    ...prev,
                                    [intId]: { ...prev[intId], projectId: e.target.value }
                                  }))}
                                  placeholder={intId === 'vercel' ? 'e.g., my-project or prj_xxx' : 'Enter project ID'}
                                  style={{
                                    width: '100%',
                                    padding: '10px 12px',
                                    background: tokens.colors.bg,
                                    border: `1px solid ${tokens.colors.border}`,
                                    borderRadius: tokens.radius.sm,
                                    color: tokens.colors.text,
                                    fontSize: '13px',
                                    fontFamily: 'inherit',
                                    outline: 'none',
                                  }}
                                />
                              </div>
                            )}
                            {intId === 'vercel' && (
                              <div>
                                <label style={{ display: 'block', fontSize: '12px', color: tokens.colors.textDim, marginBottom: '6px' }}>
                                  Team Slug (if using a team)
                                </label>
                                <input
                                  type="text"
                                  value={apiKeys[intId]?.teamId || ''}
                                  onChange={(e) => setApiKeys(prev => ({
                                    ...prev,
                                    [intId]: { ...prev[intId], teamId: e.target.value }
                                  }))}
                                  placeholder="e.g., my-team"
                                  style={{
                                    width: '100%',
                                    padding: '10px 12px',
                                    background: tokens.colors.bg,
                                    border: `1px solid ${tokens.colors.border}`,
                                    borderRadius: tokens.radius.sm,
                                    color: tokens.colors.text,
                                    fontSize: '13px',
                                    fontFamily: 'inherit',
                                    outline: 'none',
                                  }}
                                />
                                <p style={{ fontSize: '11px', color: tokens.colors.textDim, marginTop: '6px' }}>
                                  Found in your Vercel URL: vercel.com/<strong>team-slug</strong>/project
                                </p>
                              </div>
                            )}
                          </div>
                          <p style={{ fontSize: '11px', color: tokens.colors.textDim, marginTop: '12px' }}>
                            You can skip this and configure later in Settings.
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ marginTop: '24px' }}>
                  <label style={{ display: 'block', fontSize: '13px', color: tokens.colors.textMuted, marginBottom: '8px' }}>
                    Website Domain (optional)
                  </label>
                  <input
                    type="text"
                    value={projectDomain}
                    onChange={(e) => setProjectDomain(e.target.value)}
                    placeholder="e.g., myproject.com"
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: tokens.colors.bgCard,
                      border: `1px solid ${tokens.colors.border}`,
                      borderRadius: tokens.radius.sm,
                      color: tokens.colors.text,
                      fontSize: '14px',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                  <p style={{ fontSize: '12px', color: tokens.colors.textDim, marginTop: '8px' }}>
                    Used to display your project's favicon
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: '20px 24px',
              borderTop: `1px solid ${tokens.colors.border}`,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <button
              onClick={() => {
                if (step === 'integrations') setStep('type');
                else if (step === 'configure') setStep('integrations');
                else handleClose();
              }}
              style={{
                padding: '10px 20px',
                borderRadius: tokens.radius.sm,
                border: `1px solid ${tokens.colors.border}`,
                background: 'transparent',
                color: tokens.colors.textMuted,
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {step === 'type' ? 'Cancel' : 'Back'}
            </button>
            <button
              onClick={() => {
                if (step === 'type' && selectedPlatforms.length > 0) setStep('integrations');
                else if (step === 'integrations') setStep('configure');
                else if (step === 'configure') handleComplete();
              }}
              disabled={step === 'type' && selectedPlatforms.length === 0}
              style={{
                padding: '10px 20px',
                borderRadius: tokens.radius.sm,
                border: 'none',
                background: (step === 'type' && selectedPlatforms.length === 0) ? tokens.colors.border : tokens.colors.accent,
                color: 'white',
                fontSize: '13px',
                fontWeight: 500,
                cursor: (step === 'type' && selectedPlatforms.length === 0) ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {step === 'configure' ? 'Create Project' : 'Continue'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
