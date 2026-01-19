import { useTheme } from '../contexts/ThemeContext';

interface AddWidgetCardProps {
  onClick: () => void;
  size?: 'normal' | 'small';
}

export function AddWidgetCard({ onClick, size = 'normal' }: AddWidgetCardProps) {
  const { tokens } = useTheme();

  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent',
        border: `1px dashed ${tokens.colors.border}`,
        borderRadius: tokens.radius.lg,
        padding: size === 'small' ? '16px' : '24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        width: '100%',
        height: '100%',
        minHeight: size === 'small' ? '120px' : '160px',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = tokens.colors.borderHover;
        e.currentTarget.style.background = tokens.colors.bgCard;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = tokens.colors.border;
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          background: tokens.colors.bgCardHover,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: tokens.colors.textMuted,
          fontSize: '20px',
        }}
      >
        +
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: tokens.colors.textMuted, fontSize: '13px', fontWeight: 500 }}>
          Add Widget
        </div>
        <div style={{ color: tokens.colors.textDim, fontSize: '12px', marginTop: '4px' }}>
          Connect an integration
        </div>
      </div>
    </button>
  );
}
