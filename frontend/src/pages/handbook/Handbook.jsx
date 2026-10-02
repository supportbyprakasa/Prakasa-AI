import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import Button from '../../components/Button';
import Card from '../../components/Card';
import EmptyState from '../../components/EmptyState';
import Icon from '../../components/Icon';
import Page from '../../components/Page';
import SearchField from '../../components/SearchField';
import { formatDate } from '../../components/format';
import { allowedLink } from '../../components/navigation';
import { useAuth } from '../../context/AuthContext';
import HANDBOOK from './handbookContent';
import {
  anchorFor, buildOutline, levelNote, outlineParts, roleLabel, search, visibleChapters,
} from './handbookModel';
import './handbook.css';

// Panduan: the handbook, cut to the signed-in user's role (handbookModel.js).
// Left: the outline (a toggle on narrow screens); right: the chapters. The
// search box lists matching sections; every chapter and section has a deep
// link (/panduan#<chapter>-<section>). "Cetak / simpan PDF" prints only the
// chapters this user can read, behind a cover page (portal + print sheet).

function Blocks({ body, print = false }) {
  return (body || []).map((block, index) => {
    const key = `${block.type}-${index}`;
    switch (block.type) {
      case 'p':
        return <p key={key} className="hb-text">{block.text}</p>;
      case 'steps':
        return (
          <div key={key} className="hb-steps">
            {block.title ? <p className="hb-block-title">{block.title}</p> : null}
            <ol className="hb-steps__list">{block.items.map((item) => <li key={item}>{item}</li>)}</ol>
          </div>
        );
      case 'list':
        return (
          <div key={key} className="hb-list">
            {block.title ? <p className="hb-block-title">{block.title}</p> : null}
            <ul className="hb-list__items">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        );
      case 'tips':
        return (
          <div key={key} className="hb-callout hb-callout--tip">
            <Icon name="lightbulb" size="md" className="hb-callout__icon" />
            <div className="hb-callout__body">
              <p className="hb-block-title">{block.title || 'Tips'}</p>
              <ul className="hb-list__items">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </div>
        );
      case 'warning':
        return (
          <div key={key} className="hb-callout hb-callout--warning" role="note">
            <Icon name="warning" size="md" className="hb-callout__icon" />
            <p className="hb-callout__text">{block.text}</p>
          </div>
        );
      case 'note':
        return (
          <div key={key} className="hb-callout hb-callout--note" role="note">
            <Icon name="info" size="md" className="hb-callout__icon" />
            <p className="hb-callout__text">{block.text}</p>
          </div>
        );
      case 'table':
        return (
          <div key={key} className="hb-table-wrap">
            {block.title ? <p className="hb-block-title">{block.title}</p> : null}
            {/* A reference table in the text (not a data list): a CSS grid with table roles. */}
            <div className={`hb-table hb-table--cols-${Math.min(block.columns.length, 4)}`} role="table">
              <div className="hb-table__row hb-table__row--head" role="row">
                {block.columns.map((column) => <span key={column} className="hb-table__cell" role="columnheader">{column}</span>)}
              </div>
              {block.rows.map((row) => (
                <div key={row.join('|')} className="hb-table__row" role="row">
                  {row.map((cell, cellIndex) => (
                    // `context` (the table of forms Prakasa AI fills): the first cell names ONE form (i18n/en/contexts.js).
                    <span key={`${cellIndex}-${cell}`} className="hb-table__cell" role="cell" data-label={block.columns[cellIndex]} {...(block.context && cellIndex === 0 ? { 'data-i18n-context': block.context } : {})}>{cell}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      case 'faq':
        if (print) {
          return (
            <div key={key} className="hb-faq">
              {block.items.map((item) => (
                <div key={item.q} className="hb-faq__item">
                  <p className="hb-faq__q">{item.q}</p>
                  <p className="hb-faq__a">{item.a}</p>
                </div>
              ))}
            </div>
          );
        }
        return (
          <div key={key} className="hb-faq">
            {block.items.map((item) => (
              <details key={item.q} className="hb-faq__item">
                <summary className="hb-faq__q">{item.q}</summary>
                <p className="hb-faq__a">{item.a}</p>
              </details>
            ))}
          </div>
        );
      default:
        return null;
    }
  });
}

function Chapter({ chapter, permissions, print = false }) {
  const link = chapter.route ? allowedLink(chapter.route, permissions) : null;
  return (
    <Card as="article" variant="panel" className="hb-chapter" id={print ? undefined : anchorFor(chapter.id)}>
      <header className="hb-chapter__header">
        <span className="hb-chapter__icon"><Icon name={chapter.icon || 'menu_book'} /></span>
        <div className="hb-chapter__heading">
          {chapter.part ? <span className="hb-chapter__part">{chapter.part}</span> : null}
          <h2 className="hb-chapter__title">{chapter.title}</h2>
          {chapter.summary ? <p className="hb-chapter__summary">{chapter.summary}</p> : null}
          {chapter.who ? <p className="hb-chapter__who"><Icon name="group" size="sm" /> {chapter.who}</p> : null}
        </div>
        {link && !print ? (
          <div className="hb-chapter__actions"><Button variant="tonal" icon="open_in_new" to={link}>Buka menu</Button></div>
        ) : null}
      </header>
      {chapter.sections.map((section) => {
        const note = levelNote(section.audience);
        const anchor = anchorFor(chapter.id, section.id);
        return (
          <section key={section.id} className="hb-section" id={print ? undefined : anchor} aria-labelledby={print ? undefined : `${anchor}-title`}>
            <div className="hb-section__head">
              <h3 className="hb-section__title" id={print ? undefined : `${anchor}-title`}>{section.title}</h3>
              {note ? <span className="hb-tag"><Icon name="verified_user" size="sm" />{note}</span> : null}
              {!print ? (
                <Link to={{ hash: `#${anchor}` }} className="hb-section__link" aria-label={`Tautan ke bagian ${section.title}`}>
                  <Icon name="link" size="sm" />
                </Link>
              ) : null}
            </div>
            <Blocks body={section.body} print={print} />
          </section>
        );
      })}
    </Card>
  );
}

function Outline({ parts, open, onNavigate }) {
  return (
    <nav className={['hb-outline', open ? 'is-open' : ''].filter(Boolean).join(' ')} aria-label="Daftar isi panduan">
      {parts.map((part) => (
        <div key={part.title || 'umum'} className="hb-outline__part">
          {part.title ? <p className="hb-outline__part-title">{part.title}</p> : null}
          <ul className="hb-outline__list">
            {part.chapters.map((chapter) => (
              <li key={chapter.id}>
                <details className="hb-outline__chapter">
                  <summary className="hb-outline__summary">
                    <Icon name={chapter.icon || 'menu_book'} size="sm" />
                    <span>{chapter.title}</span>
                  </summary>
                  <ul className="hb-outline__sections">
                    <li><Link to={{ hash: `#${chapter.anchor}` }} onClick={onNavigate} className="hb-outline__link">Ringkasan bab</Link></li>
                    {chapter.sections.map((section) => (
                      <li key={section.id}>
                        <Link to={{ hash: `#${section.anchor}` }} onClick={onNavigate} className="hb-outline__link">
                          {section.title}
                          {section.restricted ? <Icon name="verified_user" size="sm" className="hb-outline__lock" label="Bagian khusus peran tertentu" /> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SearchResults({ hits, query }) {
  if (!hits.length) {
    return (
      <EmptyState
        icon="search_off"
        title={`Tidak ada bagian panduan yang cocok dengan "${query}"`}
        description="Coba kata lain, misalnya nama menu (Data Sales, Tiket IT) atau tombolnya (Setujui, Ajukan)."
      />
    );
  }
  return (
    <Card variant="panel" title={`${hits.length} bagian cocok`} size="sm">
      <ul className="hb-results">
        {hits.map((hit) => (
          <li key={hit.anchor}>
            <Link to={{ hash: `#${hit.anchor}` }} className="hb-results__link">
              <Icon name={hit.icon || 'menu_book'} size="sm" />
              <span className="hb-results__text">
                <span className="hb-results__title">{hit.title}</span>
                <span className="hb-results__meta">{hit.chapterTitle}</span>
                <span data-no-translate="" className="hb-results__snippet">{hit.snippet}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PrintCopy({ chapters, user, role, permissions }) {
  return createPortal(
    <div className="hb-print-root" aria-hidden="true">
      <section className="hb-cover">
        <p className="hb-cover__brand">Prakasa Workspace</p>
        <h1 className="hb-cover__title">Panduan untuk <span data-no-translate={user?.name ? '' : undefined}>{user?.name || 'Anda'}</span></h1>
        <p className="hb-cover__meta">Peran: {role}</p>
        <p className="hb-cover__meta">Dicetak: {formatDate(new Date())}</p>
        <p className="hb-cover__note">
          Panduan ini hanya memuat bagian yang sesuai dengan peran Anda. Isi menu dan tombol mengikuti aplikasi pada tanggal cetak.
        </p>
        <ol className="hb-cover__toc">{chapters.map((chapter) => <li key={chapter.id}>{chapter.title}</li>)}</ol>
      </section>
      {chapters.map((chapter) => <Chapter key={chapter.id} chapter={chapter} permissions={permissions} print />)}
    </div>,
    document.body,
  );
}

export default function Handbook() {
  const { user } = useAuth();
  const { hash } = useLocation();
  const [query, setQuery] = useState('');
  const [outlineOpen, setOutlineOpen] = useState(false);
  const permissions = user?.permissions || [];
  const chapters = useMemo(() => visibleChapters(user, HANDBOOK), [user]);
  const parts = useMemo(() => outlineParts(buildOutline(chapters)), [chapters]);
  const hits = useMemo(() => search(chapters, query), [chapters, query]);
  const role = roleLabel(user);
  const searching = query.trim().length > 1;

  // Deep link: scroll to the chapter/section named in the hash (also after a
  // search result or an outline link is clicked).
  useEffect(() => {
    const id = decodeURIComponent((hash || '').slice(1));
    if (!id) return;
    setQuery('');
    let frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ block: 'start' });
        if (target.tagName === 'SECTION') target.querySelector('details:not([open])')?.setAttribute('open', '');
      }
    }); });
    return () => window.cancelAnimationFrame(frame);
  }, [hash]);

  return (
    <Page
      className="hb-page"
      title="Panduan"
      description="Cara memakai Prakasa Workspace, langkah demi langkah."
      actions={<Button variant="secondary" icon="print" onClick={() => window.print()}>Cetak / simpan PDF</Button>}
    >
      <div className="hb-role-note" role="note">
        <Icon name="badge" size="md" />
        <p className="hb-role-note__text">Bagian yang Anda lihat disesuaikan dengan peran Anda: <span className="hb-role-note__role">{role}</span></p>
      </div>

      <div className="hb-toolbar">
        <SearchField
          variant="panel"
          className="hb-search"
          placeholder="Cari di panduan, misalnya: ajukan reimbursement"
          label="Cari di panduan"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          variant="text"
          icon={outlineOpen ? 'close' : 'toc'}
          className="hb-outline-toggle"
          aria-expanded={outlineOpen}
          onClick={() => setOutlineOpen((open) => !open)}
        >
          Daftar isi
        </Button>
      </div>

      {chapters.length ? (
        <div className="hb-layout">
          <aside className="hb-aside">
            <Outline parts={parts} open={outlineOpen} onNavigate={() => setOutlineOpen(false)} />
          </aside>
          <div className="hb-content">
            {searching ? <SearchResults hits={hits} query={query.trim()} /> : null}
            <div className={searching ? 'hb-chapters is-hidden' : 'hb-chapters'}>
              {chapters.map((chapter) => <Chapter key={chapter.id} chapter={chapter} permissions={permissions} />)}
            </div>
          </div>
        </div>
      ) : (
        <EmptyState icon="menu_book" title="Belum ada panduan untuk peran Anda" description="Hubungi Administrator Sistem bila menu Anda terasa kurang." />
      )}

      {chapters.length ? <PrintCopy chapters={chapters} user={user} role={role} permissions={permissions} /> : null}
    </Page>
  );
}
