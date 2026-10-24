import type { ComponentPropsWithRef, ReactNode } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import styles from './IconButton.module.css'

type IconButtonProps = ComponentPropsWithRef<'button'> & {
  label: string
  children: ReactNode
  variant?: 'plain' | 'window' | 'window-close'
}

export function IconButton({
  label,
  children,
  variant = 'plain',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={[styles.button, styles[variant], className].filter(Boolean).join(' ')}
          {...rest}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={styles.tooltip} sideOffset={6}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
