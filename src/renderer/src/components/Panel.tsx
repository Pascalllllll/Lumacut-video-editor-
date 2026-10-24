import type { ReactNode } from 'react'
import styles from './Panel.module.css'

function Root({ label, area, children }: { label: string; area: string; children: ReactNode }) {
  return (
    <section
      className={styles.panel}
      style={{ gridArea: area }}
      aria-label={label}
      data-tour={area}
    >
      {children}
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
