import React from 'react';

interface Email {
  id: string;
  from: string;
  subject: string;
  preview: string;
  time: string;
  unread: boolean;
  type: 'stripe' | 'customer' | 'alert' | 'general';
}

const mockEmails: Email[] = [
  {
    id: '1',
    from: 'Stripe',
    subject: 'New subscription created',
    preview: 'A new customer just subscribed to your Pro plan...',
    time: '2m ago',
    unread: true,
    type: 'stripe',
  },
  {
    id: '2',
    from: 'Customer Support',
    subject: 'Re: Question about pricing',
    preview: 'Thank you for reaching out. Our enterprise pricing...',
    time: '15m ago',
    unread: true,
    type: 'customer',
  },
  {
    id: '3',
    from: 'System Alert',
    subject: 'Monthly revenue milestone reached',
    preview: 'Congratulations! You have reached $5,000 MRR...',
    time: '1h ago',
    unread: false,
    type: 'alert',
  },
  {
    id: '4',
    from: 'Stripe',
    subject: 'Payment succeeded',
    preview: 'Payment of $49.00 from john@example.com...',
    time: '3h ago',
    unread: false,
    type: 'stripe',
  },
];

const typeIcons: Record<string, { icon: React.ReactNode; color: string }> = {
  stripe: {
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
      </svg>
    ),
    color: 'bg-[#635bff]/20 text-[#635bff]',
  },
  customer: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    color: 'bg-emerald-500/20 text-emerald-400',
  },
  alert: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
    color: 'bg-amber-500/20 text-amber-400',
  },
  general: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    color: 'bg-gray-500/20 text-gray-400',
  },
};

export function EmailsWidget() {
  return (
    <div className="bg-[#111] border border-white/[0.06] rounded-xl overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <h3 className="text-sm font-medium">Recent Emails</h3>
        <span className="text-xs text-[var(--text-secondary)]">4 unread</span>
      </div>

      <div className="divide-y divide-white/[0.04]">
        {mockEmails.map((email) => {
          const typeStyle = typeIcons[email.type];
          return (
            <div
              key={email.id}
              className={`px-4 py-3 hover:bg-white/[0.02] cursor-pointer transition-colors ${
                email.unread ? 'bg-white/[0.01]' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg ${typeStyle.color} flex items-center justify-center flex-shrink-0`}>
                  {typeStyle.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className={`text-sm ${email.unread ? 'font-medium' : 'text-[var(--text-secondary)]'}`}>
                      {email.from}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)] flex-shrink-0">{email.time}</span>
                  </div>
                  <p className={`text-sm truncate ${email.unread ? '' : 'text-[var(--text-secondary)]'}`}>
                    {email.subject}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{email.preview}</p>
                </div>
                {email.unread && (
                  <div className="w-2 h-2 rounded-full bg-[var(--accent)] flex-shrink-0 mt-2" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2 border-t border-white/[0.06]">
        <button className="text-xs text-[var(--accent)] hover:text-[var(--accent)]/80 transition-colors">
          View all emails
        </button>
      </div>
    </div>
  );
}
