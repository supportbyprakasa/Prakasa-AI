import { useEffect, useState } from 'react';
import { Sparkles, MessageSquare, Link2, ClipboardList } from 'lucide-react';
import AISessionList from '../../components/ai/AISessionList';
import AIConversation from '../../components/ai/AIConversation';
import AIContextPanel from '../../components/ai/AIContextPanel';
import AIActionProposals from '../../components/ai/AIActionProposals';
import api from '../../api/client';

/**
 * AI Command Center — 3-panel workspace.
 * Desktop: sessions | conversation | context+actions
 * Tablet: sessions | conversation (+ drawer for right panel)
 * Mobile: tab bar between panels
 */

function useBreakpoint() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return {
    isMobile: width < 700,
    isTablet: width >= 700 && width < 1000,
    isDesktop: width >= 1000,
  };
}

export default function AICommandCenter() {
  const { isMobile, isDesktop } = useBreakpoint();

  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedSession, setSelectedSession] = useState(null);
  const [rightPanelTab, setRightPanelTab] = useState('context');
  const [mobileTab, setMobileTab] = useState('sessions'); // sessions | chat | context

  // Load selected session when id changes
  useEffect(() => {
    if (!selectedSessionId) { setSelectedSession(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get(`/ai-command/sessions/${selectedSessionId}`);
        if (!cancelled) setSelectedSession(r.data.data);
      } catch {
        if (!cancelled) setSelectedSession(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSessionId, refreshKey]);

  // When user selects a session on mobile, jump to chat
  const handleSelectSession = (id) => {
    setSelectedSessionId(id);
    if (isMobile) setMobileTab('chat');
  };

  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  /* ----------------------------------------------------------
     Desktop / large screens: 3 panels
     ---------------------------------------------------------- */
  if (isDesktop) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: '280px 1fr 360px',
        height: 'calc(100vh - 120px)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--color-surface)',
      }}>
        {/* Session list */}
        <div style={{
          borderRight: '1px solid var(--color-border)',
          minHeight: 0, display: 'flex', flexDirection: 'column',
        }}>
          <PanelHeader icon={Sparkles} title="AI Command Center" />
          <AISessionList
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
            refreshKey={refreshKey}
          />
        </div>

        {/* Conversation */}
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <AIConversation
            sessionId={selectedSessionId}
            onSessionUpdated={bumpRefresh}
            onSessionDeleted={() => {
              setSelectedSessionId(null);
              setSelectedSession(null);
              if (isMobile) setMobileTab('sessions');
            }}
          />
        </div>

        {/* Right panel */}
        <div style={{
          borderLeft: '1px solid var(--color-border)',
          minHeight: 0, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', borderBottom: '1px solid var(--color-border)',
          }}>
            <RightTab
              active={rightPanelTab === 'context'}
              onClick={() => setRightPanelTab('context')}
              icon={Link2}
              label="Context"
            />
            <RightTab
              active={rightPanelTab === 'actions'}
              onClick={() => setRightPanelTab('actions')}
              icon={ClipboardList}
              label="Actions"
            />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {rightPanelTab === 'context' && (
              <AIContextPanel
                sessionId={selectedSessionId}
                session={selectedSession}
                refreshKey={refreshKey}
              />
            )}
            {rightPanelTab === 'actions' && (
              <AIActionProposals
                sessionId={selectedSessionId}
                session={selectedSession}
                refreshKey={refreshKey}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------
     Mobile / tablet: tabbed
     ---------------------------------------------------------- */
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - 120px)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      overflow: 'hidden',
      background: 'var(--color-surface)',
    }}>
      {/* Mobile tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <MobileTab
          active={mobileTab === 'sessions'}
          onClick={() => setMobileTab('sessions')}
          label="Chats"
          icon={MessageSquare}
        />
        <MobileTab
          active={mobileTab === 'chat'}
          onClick={() => setMobileTab('chat')}
          label="Percakapan"
          icon={Sparkles}
        />
        <MobileTab
          active={mobileTab === 'context'}
          onClick={() => setMobileTab('context')}
          label="Context"
          icon={Link2}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {mobileTab === 'sessions' && (
          <AISessionList
            selectedSessionId={selectedSessionId}
            onSelectSession={handleSelectSession}
            refreshKey={refreshKey}
          />
        )}
        {mobileTab === 'chat' && (
          <AIConversation
            sessionId={selectedSessionId}
            onSessionUpdated={bumpRefresh}
            onSessionDeleted={() => {
              setSelectedSessionId(null);
              setSelectedSession(null);
              if (isMobile) setMobileTab('sessions');
            }}
          />
        )}
        {mobileTab === 'context' && (
          <>
            <div style={{
              display: 'flex', borderBottom: '1px solid var(--color-border)',
            }}>
              <RightTab
                active={rightPanelTab === 'context'}
                onClick={() => setRightPanelTab('context')}
                icon={Link2}
                label="Context"
              />
              <RightTab
                active={rightPanelTab === 'actions'}
                onClick={() => setRightPanelTab('actions')}
                icon={ClipboardList}
                label="Actions"
              />
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {rightPanelTab === 'context' && (
                <AIContextPanel
                  sessionId={selectedSessionId}
                  session={selectedSession}
                  refreshKey={refreshKey}
                />
              )}
              {rightPanelTab === 'actions' && (
                <AIActionProposals
                  sessionId={selectedSessionId}
                  session={selectedSession}
                  refreshKey={refreshKey}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Small UI bits
   ============================================================ */

function PanelHeader({ icon: Icon, title }) {
  return (
    <div style={{
      padding: 12, borderBottom: '1px solid var(--color-border)',
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 13, fontWeight: 600,
    }}>
      <Icon size={14} /> {title}
    </div>
  );
}

function RightTab({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: 10,
        background: 'transparent', border: 'none',
        borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
        fontSize: 13, fontWeight: 500, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}
    >
      <Icon size={13} /> {label}
    </button>
  );
}

function MobileTab({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: 10,
        background: 'transparent', border: 'none',
        borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
        fontSize: 12, fontWeight: 500, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
      }}
    >
      <Icon size={13} /> {label}
    </button>
  );
}