import { useState } from 'react';
import { Building2, Lock, SlidersHorizontal, Sparkles, Users } from 'lucide-react';
import api from '../../api/client';
import { toast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import AIComposer from './AIComposer';
import AIDropdown from './AIDropdown';
import { CreateSessionModal } from './AISessionList';
import {
  VISIBILITY_LABELS,
  engineChipLabel,
  engineMenuItems,
  visibilityMenuItems,
} from './aiEngineOptions';
import {
  firstNameOf,
  greetingForHour,
  titleFromMessage,
} from '../../pages/ai/aiCommandCenterModel';

const SUGGESTIONS = [
  'Bantu susun draft dokumen',
  'Ringkas laporan minggu ini',
  'Periksa selisih data penjualan',
];

const VISIBILITY_ICONS = { private: Lock, department: Users, entity: Building2 };

export default function AINewChat({ providers, providersLoading, onSessionCreated }) {
  const { user } = useAuth();
  const canCreate = (user?.permissions || []).includes('ai_command.use');
  const available = providers.filter((item) => item.available);
  const defaultProvider = (available.find((item) => item.isDefault) || available[0])?.id || '';

  const [provider, setProvider] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [input, setInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const selectedProvider = available.some((item) => item.id === provider) ? provider : defaultProvider;
  const name = firstNameOf(user);
  const greeting = greetingForHour(new Date().getHours());

  const submit = async () => {
    const text = input.trim();
    if (!text || creating) return;
    if (!selectedProvider) {
      toast('Belum ada engine AI yang tersedia untuk akun Anda', 'error');
      return;
    }
    setCreating(true);
    try {
      const response = await api.post('/ai-command/sessions', {
        title: titleFromMessage(text),
        visibility,
        provider: selectedProvider,
      });
      onSessionCreated(response.data.data.id, text);
    } catch (error) {
      toast(error.response?.data?.error?.message || 'Gagal memulai percakapan', 'error');
      setCreating(false);
    }
  };

  return (
    <div className="ai-new-chat">
      <div className="ai-new-chat-inner">
        <h1 className="ai-greeting">
          <span className="ai-greeting-mark" aria-hidden="true"><Sparkles size={24} /></span>
          <span>{greeting}{name ? `, ${name}` : ''}</span>
        </h1>

        {!canCreate ? (
          <p className="ai-greeting-sub">
            Akun Anda belum memiliki izin untuk memulai percakapan AI. Pilih percakapan yang dibagikan dari panel kiri.
          </p>
        ) : (
          <>
            <p className="ai-greeting-sub">Apa yang ingin Anda kerjakan hari ini?</p>
            <AIComposer
              value={input}
              onChange={setInput}
              onSubmit={submit}
              autoFocus
              busy={creating}
              disabled={creating}
              sendDisabled={creating || !input.trim() || !selectedProvider}
              placeholder="Tanyakan atau minta apa saja ke Prakasa AI…"
              tools={(
                <AIDropdown
                  icon={VISIBILITY_ICONS[visibility]}
                  label={VISIBILITY_LABELS[visibility]}
                  ariaLabel="Siapa yang dapat melihat percakapan ini"
                  items={visibilityMenuItems(user)}
                  value={visibility}
                  onSelect={setVisibility}
                  disabled={creating}
                  placement="bottom"
                />
              )}
              trailing={(
                <AIDropdown
                  label={providersLoading
                    ? 'Memuat engine…'
                    : selectedProvider ? engineChipLabel(providers, selectedProvider) : 'Tidak ada engine'}
                  ariaLabel="Pilih engine AI"
                  items={engineMenuItems(providers)}
                  value={selectedProvider}
                  onSelect={setProvider}
                  disabled={creating || providersLoading || !available.length}
                  align="right"
                  placement="bottom"
                />
              )}
            />

            <div className="ai-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="ai-suggestion-chip ai-ripple"
                  onClick={() => setInput(suggestion)}
                  disabled={creating}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="ai-text-button ai-ripple ai-advanced-link"
              onClick={() => setAdvancedOpen(true)}
              disabled={creating}
            >
              <SlidersHorizontal size={15} /> Opsi lanjutan
            </button>
          </>
        )}
      </div>

      <p className="ai-disclaimer">
        Prakasa AI dapat membuat kesalahan. Periksa kembali informasi penting. · Powered by Prakasa
      </p>

      <CreateSessionModal
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        onCreated={(id) => {
          setAdvancedOpen(false);
          onSessionCreated(id, null);
        }}
      />
    </div>
  );
}
