import * as Dialog from '@radix-ui/react-dialog'
import { t } from '../../i18n'
import { answerReview, useReview } from '../../lib/mcp-bridge'
import sheet from '../../components/Sheet.module.css'
import { DiffView } from './DiffView'

/** An edit another AI tool asked for over MCP, shown before it lands. */
export function ReviewDialog() {
  const review = useReview((s) => s.review)
  return (
    <Dialog.Root open={review !== null} onOpenChange={(open) => !open && answerReview(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={sheet.overlay} />
        <Dialog.Content className={sheet.sheet}>
          <Dialog.Title className={sheet.title}>{t('copilot.mcpTitle')}</Dialog.Title>
          <Dialog.Description className={sheet.body}>
            {t('copilot.mcpBody', { label: review?.label ?? '' })}
          </Dialog.Description>
          {review ? <DiffView diff={review.diff} /> : null}
          <div className={sheet.actions}>
            <button type="button" className={sheet.button} onClick={() => answerReview(false)}>
              {t('copilot.decline')}
            </button>
            <button
              type="button"
              className={`${sheet.button} ${sheet.primary}`}
              onClick={() => answerReview(true)}
              autoFocus
            >
              {t('copilot.apply')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
