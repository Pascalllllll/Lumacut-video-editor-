import { Component, type ReactNode } from 'react'
import { t } from '../i18n'
import { EmptyState } from './EmptyState'
import styles from './Panel.module.css'

/** One panel failing shows its own message instead of taking the whole window down. */
class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  override render() {
    if (this.state.error === null) return this.props.children
    return (
      <div role="alert" className={styles.body}>
        <EmptyState
          title={t('panel.failedTitle')}
          body={t('panel.failed', { reason: this.state.error })}
          action={
            <button type="button" onClick={() => this.setState({ error: null })}>
              {t('panel.retry')}
            </button>
          }
        />
      </div>
    )
  }
}

function Root({ label, area, children }: { label: string; area: string; children: ReactNode }) {
  return (
    <section
      className={styles.panel}
      style={{ gridArea: area }}
      aria-label={label}
      data-tour={area}
    >
      <Boundary>{children}</Boundary>
    </section>
  )
}

function Header({ children }: { children: ReactNode }) {
  return <header className={styles.header}>{children}</header>
}

function Title({ children }: { children: ReactNode }) {
  return <h2 className={styles.title}>{children}</h2>
}

function Body({
  children,
  inset = false,
  hidden = false,
}: {
  children: ReactNode
  inset?: boolean
  hidden?: boolean
}) {
  return (
    <div className={inset ? `${styles.body} ${styles.inset}` : styles.body} hidden={hidden}>
      {children}
    </div>
  )
}

export const Panel = { Root, Header, Title, Body }
