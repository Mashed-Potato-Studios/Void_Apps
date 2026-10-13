import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  MouseEvent,
  ReactNode,
} from 'react';

const FOCUS_VISIBLE_CSS =
  '[data-void-focusable]:focus-visible{outline:2px solid var(--void-electric,#00e5ff);outline-offset:2px;border-radius:4px}';

export interface HeaderLink {
  label: string;
  href: string;
  active?: boolean;
}

export interface HeaderProps extends HTMLAttributes<HTMLElement> {
  appName: string;
  badgeText?: string;
  links?: HeaderLink[];
  homeHref?: string;
  navAriaLabel?: string;
}

export function Header({
  appName,
  badgeText = 'Void Cloud',
  links = [],
  homeHref = '/',
  navAriaLabel = 'Primary',
  className,
  style,
  ...rest
}: HeaderProps): ReactNode {
  return (
    <header
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.5rem',
        borderBottom: '1px solid var(--void-border, #231f32)',
        backgroundColor: 'var(--void-bg, #08060d)',
        ...style,
      }}
      {...rest}
    >
      <style>{FOCUS_VISIBLE_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <a
          href={homeHref}
          data-void-focusable
          style={{
            color: 'var(--void-text, #ffffff)',
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
              fontFamily: 'var(--void-font-mono, monospace)',
              padding: '0.15rem 0.45rem',
              borderRadius: 'var(--void-radius-sm, 4px)',
              backgroundColor: 'var(--void-bg-card, #151220)',
              border: '1px solid var(--void-border, #231f32)',
              color: 'var(--void-text-muted, #9490a5)',
            }}
          >
            {badgeText}
          </span>
        )}
      </div>

      <nav aria-label={navAriaLabel} style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
        {links.map((link, index) => (
          <a
            key={`${link.href}::${link.label}::${index}`}
            href={link.href}
            aria-current={link.active ? 'page' : undefined}
            data-void-focusable
            style={{
              color: link.active
                ? 'var(--void-text, #ffffff)'
                : 'var(--void-text-muted, #9490a5)',
              textDecoration: link.active ? 'underline' : 'none',
              textUnderlineOffset: link.active ? '4px' : undefined,
              textDecorationThickness: link.active ? '2px' : undefined,
              fontWeight: link.active ? 600 : 400,
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
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  tag?: string;
  headingLevel?: HeadingLevel;
}

export function Card({
  title,
  description,
  children,
  footer,
  tag,
  headingLevel = 3,
  className,
  style,
  ...rest
}: CardProps): ReactNode {
  const TitleTag = `h${headingLevel}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return (
    <div
      className={className}
      style={{
        backgroundColor: 'var(--void-bg-subtle, #100e18)',
        border: '1px solid var(--void-border, #231f32)',
        borderRadius: 'var(--void-radius-md, 8px)',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        ...style,
      }}
      {...rest}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <TitleTag
          style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, color: 'var(--void-text, #ffffff)' }}
        >
          {title}
        </TitleTag>
        {tag && (
          <span
            style={{
              fontSize: '0.75rem',
              fontFamily: 'var(--void-font-mono, monospace)',
              padding: '0.15rem 0.5rem',
              borderRadius: 'var(--void-radius-sm, 4px)',
              backgroundColor: 'rgba(0, 229, 255, 0.1)',
              border: '1px solid rgba(0, 229, 255, 0.25)',
              color: 'var(--void-electric, #00e5ff)',
            }}
          >
            {tag}
          </span>
        )}
      </div>
      {description && (
        <p
          style={{
            margin: 0,
            fontSize: '0.875rem',
            color: 'var(--void-text-muted, #9490a5)',
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}
      {children && <div>{children}</div>}
      {footer && (
        <div
          style={{
            paddingTop: '0.75rem',
            borderTop: '1px solid var(--void-border, #231f32)',
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

type ButtonBase = {
  variant?: 'primary' | 'secondary' | 'outline';
  children?: ReactNode;
};

export type ButtonAsButtonProps = ButtonBase &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    asLink?: false;
    href?: never;
  };

export type ButtonAsLinkProps = ButtonBase &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    asLink: true;
    href: string;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

const baseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '0.5rem 1rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  borderRadius: 'var(--void-radius-sm, 4px)',
  cursor: 'pointer',
  textDecoration: 'none',
  border: '1px solid transparent',
  transition: 'all 0.15s ease',
};

const variantStyles: Record<NonNullable<ButtonBase['variant']>, CSSProperties> = {
  primary: {
    backgroundColor: 'var(--void-accent, #ffffff)',
    color: 'var(--void-accent-contrast, #08060d)',
    fontWeight: 600,
  },
  secondary: {
    backgroundColor: 'var(--void-bg-card, #151220)',
    color: 'var(--void-text, #ffffff)',
    borderColor: 'var(--void-border, #231f32)',
  },
  outline: {
    backgroundColor: 'transparent',
    color: 'var(--void-text, #ffffff)',
    borderColor: 'var(--void-border, #231f32)',
  },
};

export function Button(props: ButtonProps): ReactNode {
  const variant = props.variant ?? 'primary';

  if (props.asLink) {
    const { children, style, onClick, variant: _variant, asLink: _asLink, ...anchorRest } = props;
    const computedStyle: CSSProperties = { ...baseStyle, ...variantStyles[variant], ...style };
    const isDisabled =
      anchorRest['aria-disabled'] === true || anchorRest['aria-disabled'] === 'true';

    function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
      if (isDisabled) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    }

    return (
      <>
        <style>{FOCUS_VISIBLE_CSS}</style>
        <a
          data-void-focusable
          aria-disabled={isDisabled || undefined}
          style={{
            ...computedStyle,
            ...(isDisabled
              ? { cursor: 'not-allowed', opacity: 0.5, pointerEvents: 'none' as const }
              : null),
          }}
          {...anchorRest}
          onClick={handleClick}
        >
          {children}
        </a>
      </>
    );
  }

  const { children, style, type, variant: _variant, asLink: _asLink, ...buttonRest } = props;
  const computedStyle: CSSProperties = { ...baseStyle, ...variantStyles[variant], ...style };

  return (
    <>
      <style>{FOCUS_VISIBLE_CSS}</style>
      <button data-void-focusable type={type ?? 'button'} style={computedStyle} {...buttonRest}>
        {children}
      </button>
    </>
  );
}
