import { useEffect, useState } from 'react'
import { PROVIDER_IDS, PROVIDERS, staysLocal, type ProviderId } from '@shared/providers'
import type { IpcResponse } from '@shared/ipc'
import type { Settings } from '@shared/settings'
import { t, td } from '../i18n'
import { notify } from '../state/notices'
import { useSettings } from '../state/settings'
import styles from './SettingsDialog.module.css'

const message = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  )

/** Copilot provider, key, model, privacy, and the MCP server for other AI tools. */
export function AiSection() {
  const ai = useSettings((s) => s.settings.ai)
  const update = useSettings((s) => s.update)
  const set = (patch: Partial<Settings['ai']>) => void update({ ai: { ...ai, ...patch } })
  const [keys, setKeys] = useState<IpcResponse<'ai:keys'> | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  // The model list belongs to the provider and address it was loaded from.
  const [loaded, setLoaded] = useState<{ from: string; list: string[] }>({ from: '', list: [] })
  const [checking, setChecking] = useState(false)
  const [mcp, setMcp] = useState<IpcResponse<'mcp:status'> | null>(null)
  const provider = ai.provider
  const info = provider ? PROVIDERS[provider] : null

  useEffect(() => {
    void window.lumacut.invoke('ai:keys').then(setKeys)
  }, [])
  useEffect(() => {
    void window.lumacut.invoke('mcp:status').then(setMcp)
  }, [ai.mcp])
  const source = `${provider ?? ''} ${ai.baseUrl}`
  const models = loaded.from === source ? loaded.list : []

  const check = async () => {
    if (!provider) return
    setChecking(true)
    try {
      const list = await window.lumacut.invoke('ai:models', { provider, baseUrl: ai.baseUrl })
      setLoaded({ from: source, list })
      notify('info', t('ai.connected', { count: list.length }))
      if (!ai.model && list.length) set({ model: PROVIDERS[provider].defaultModel || list[0]! })
    } catch (error) {
      notify('error', message(error))
    } finally {
      setChecking(false)
    }
  }
  const saveKey = async (key: string | null) => {
    if (!provider) return
    try {
      await window.lumacut.invoke('ai:set-key', { provider, key })
      setKeyDraft('')
      setKeys(await window.lumacut.invoke('ai:keys'))
      notify('info', key ? t('ai.keySaved') : t('ai.keyRemoved'))
    } catch (error) {
      notify('error', message(error))
    }
  }
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text)
    notify('info', t('ai.copied'))
  }
  const hasKey = provider ? (keys?.set.includes(provider) ?? false) : false
  const blocked = provider && ai.localOnly && !staysLocal(provider, ai.baseUrl)

  return (
    <section className={styles.section} aria-labelledby="settings-ai">
      <h3 id="settings-ai" className={styles.sectionTitle}>
        {t('ai.title')}
      </h3>
      <div className={styles.row}>
        <label className={styles.label} htmlFor="ai-provider">
          {t('ai.provider')}
        </label>
        <select
          id="ai-provider"
          className={styles.select}
          value={provider ?? ''}
          onChange={(e) => {
            const id = (e.target.value || null) as ProviderId | null
            set({ provider: id, model: id ? PROVIDERS[id].defaultModel : '', baseUrl: '' })
          }}
        >
          <option value="">{t('ai.none')}</option>
          {PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {td(`copilot.provider.${id}`)}
            </option>
          ))}
        </select>
      </div>
      {provider && info ? (
        <>
          {provider === 'custom' || info.local ? (
            <div className={styles.row}>
              <label className={styles.label} htmlFor="ai-url">
                {t('ai.address')}
              </label>
              <input
                id="ai-url"
                className={styles.text}
                placeholder={info.baseUrl || 'http://127.0.0.1:8080/v1'}
                defaultValue={ai.baseUrl}
                onBlur={(e) => set({ baseUrl: e.target.value.trim() })}
              />
            </div>
          ) : null}
          {info.key || provider === 'custom' ? (
            <div className={styles.row}>
              <label className={styles.label} htmlFor="ai-key">
                {t('ai.key')}
              </label>
              <div className={styles.inlineGroup}>
                <input
                  id="ai-key"
                  type="password"
                  autoComplete="off"
                  className={styles.text}
                  placeholder={hasKey ? t('ai.keyStored') : t('ai.keyPlaceholder')}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                />
                <button
                  type="button"
                  className={styles.button}
                  disabled={!keyDraft.trim()}
                  onClick={() => void saveKey(keyDraft.trim())}
                >
                  {t('ai.saveKey')}
                </button>
                {hasKey ? (
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => void saveKey(null)}
                  >
                    {t('ai.removeKey')}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {keys && !keys.keyring && (info.key || provider === 'custom') ? (
            <p className={styles.note}>{t('ai.noKeyring')}</p>
          ) : null}
          <div className={styles.row}>
            <label className={styles.label} htmlFor="ai-model">
              {t('ai.model')}
            </label>
            <div className={styles.inlineGroup}>
              <input
                id="ai-model"
                className={styles.text}
                list="ai-models"
                defaultValue={ai.model}
                key={ai.model}
                onBlur={(e) => set({ model: e.target.value.trim() })}
              />
              <datalist id="ai-models">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <button
                type="button"
                className={styles.button}
                disabled={checking}
                onClick={() => void check()}
              >
                {checking ? t('ai.checking') : t('ai.check')}
              </button>
            </div>
          </div>
          {blocked ? <p className={styles.modelError}>{t('ai.blocked')}</p> : null}
        </>
      ) : null}
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={ai.localOnly}
          onChange={(e) => set({ localOnly: e.target.checked })}
        />
        <span>
          {t('ai.localOnly')}
          <span className={styles.modelMeta}>{t('ai.localOnlyHint')}</span>
        </span>
      </label>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={ai.applyMode === 'auto'}
          onChange={(e) => set({ applyMode: e.target.checked ? 'auto' : 'ask' })}
        />
        <span>
          {t('ai.applyAuto')}
          <span className={styles.modelMeta}>{t('ai.applyAutoHint')}</span>
        </span>
      </label>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={ai.mcp}
          onChange={(e) =>
            // The server starts or stops before the settings call returns; then read its address.
            void update({ ai: { ...ai, mcp: e.target.checked } })
              .then(() => window.lumacut.invoke('mcp:status'))
              .then(setMcp)
          }
        />
        <span>
          {t('ai.mcp')}
          <span className={styles.modelMeta}>{t('ai.mcpHint')}</span>
        </span>
      </label>
      {ai.mcp && mcp?.running && mcp.url && mcp.token ? (
        <div className={styles.mcp}>
          <p className={styles.modelMeta}>{t('ai.mcpAt', { url: mcp.url })}</p>
          <div className={styles.inlineGroup}>
            <button
              type="button"
              className={styles.button}
              onClick={() =>
                copy(
                  `claude mcp add --transport http lumacut ${mcp.url} --header "Authorization: Bearer ${mcp.token}"`,
                )
              }
            >
              {t('ai.copyClaudeCode')}
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() =>
                copy(
                  JSON.stringify(
                    {
                      mcpServers: {
                        lumacut: {
                          command: mcp.stdio.command,
                          args: mcp.stdio.args,
                          env: mcp.stdio.env,
                        },
                      },
                    },
                    null,
                    2,
                  ),
                )
              }
            >
              {t('ai.copyStdio')}
            </button>
            <button type="button" className={styles.button} onClick={() => copy(mcp.token!)}>
              {t('ai.copyToken')}
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() =>
                void window.lumacut
                  .invoke('mcp:new-token')
                  .then(() => window.lumacut.invoke('mcp:status'))
                  .then(setMcp)
              }
            >
              {t('ai.newToken')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
