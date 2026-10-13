import React from 'react';

export interface HeaderProps {
  appName: string;
  badgeText?: string;
  links?: Array<{ label: string; href: string; active?: boolean }>;
}

export const Header: React.FC<HeaderProps> = ({
  appName,
  badgeText = 'Void Cloud',
  links = [],
}) => {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.5rem',
        borderBottom: '1px solid var(--void-border, #231f32)',
        backgroundColor: 'var(--void-bg, #08060d)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <a
          href="/"
          style={{
            color: '#fff',
            textDecoration: 'none',
            fontSize: '1.125rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
          }}
        >
          {appName}
        </a>
        {badgeText && (
          <span
            style={{
              fontSize: '0.7rem',
              fontFamily: 'monospace',
              padding: '0.15rem 0.45rem',
              borderRadius: '4px',
              backgroundColor: '#151220',
              border: '1px solid #231f32',
              color: '#9490a5',
            }}
          >
            {badgeText}
          </span>
        )}
      </div>

      <nav style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            style={{
              color: link.active ? '#ffffff' : '#9490a5',
              textDecoration: 'none',
              fontSize: '0.875rem',
              transition: 'color 0.15s ease',
            }}
          >
            {link.label}
          </a>
        ))}
      </nav>
    </header>
  );
};

export interface CardProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  tag?: string;
}

export const Card: React.FC<CardProps> = ({
  title,
  description,
  children,
  footer,
  tag,
}) => {
  return (
    <div
      style={{
        backgroundColor: '#100e18',
        border: '1px solid #231f32',
        borderRadius: '8px',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, color: '#fff' }}>
          {title}
        </h3>
        {tag && (
          <span
            style={{
              fontSize: '0.75rem',
              fontFamily: 'monospace',
              padding: '0.15rem 0.5rem',
              borderRadius: '4px',
              backgroundColor: 'rgba(0, 229, 255, 0.1)',
              border: '1px solid rgba(0, 229, 255, 0.25)',
              color: '#00e5ff',
            }}
          >
            {tag}
          </span>
        )}
      </div>
      {description && (
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#9490a5', lineHeight: 1.5 }}>
          {description}
        </p>
      )}
      {children && <div>{children}</div>}
      {footer && (
        <div style={{ paddingTop: '0.75rem', borderTop: '1px solid #231f32' }}>
          {footer}
        </div>
      )}
    </div>
  );
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline';
  asLink?: boolean;
  href?: string;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  children,
  asLink,
  href,
  style,
  ...props
}) => {
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    borderRadius: '4px',
    cursor: 'pointer',
    textDecoration: 'none',
    border: '1px solid transparent',
    transition: 'all 0.15s ease',
  };

  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: '#ffffff',
      color: '#08060d',
      fontWeight: 600,
    },
    secondary: {
      backgroundColor: '#151220',
      color: '#ffffff',
      borderColor: '#231f32',
    },
    outline: {
      backgroundColor: 'transparent',
      color: '#ffffff',
      borderColor: '#231f32',
    },
  };

  const computedStyle = { ...baseStyle, ...variantStyles[variant], ...style };

  if (asLink && href) {
    return (
      <a href={href} style={computedStyle}>
        {children}
      </a>
    );
  }

  return (
    <button style={computedStyle} {...props}>
      {children}
    </button>
  );
};
