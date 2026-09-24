import { Sparkles } from 'lucide-react';
import { usePrakasaAIToolContext } from '../../context/PrakasaAIToolContext';

// One contextual entry point per authenticated page; hidden where no tool is registered
// for this user (unknown route, no permission, or the AI Command Center itself).
export default function PrakasaAIAssistButton() {
  const context = usePrakasaAIToolContext();
  if (!context?.enabled || !context.resolved || context.open) return null;
  if (context.resolved.tool.key === 'ai-command') return null;

  return (
    <button
      type="button"
      className="pw-ai-fab pw-button pw-ripple"
      onClick={() => context.setOpen(true)}
      aria-label={`Bantu dengan Prakasa AI di ${context.resolved.tool.title}`}
    >
      <Sparkles size={20} aria-hidden="true" />
      <span>Bantu dengan Prakasa AI</span>
    </button>
  );
}
