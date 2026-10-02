import Button from '../../../components/Button';
import { parseChatText, safeHref } from '../chatModel';
import { RichNodes } from './parts';

// A Chat app's cardsV2, read-only: header, paragraphs, labelled values and
// link buttons. The server already flattened the card HTML to plain text;
// interactive widgets (forms, action buttons) can't run outside Google Chat,
// so action buttons show disabled. Everything a card says was written by the
// app that sent it: record data, never translated.
function Widget({ widget }) {
  if (widget.type === 'divider') return <hr className="pw-gchat__card-divider" />;
  if (widget.type === 'text') return <div className="pw-gchat__card-text"><RichNodes nodes={parseChatText(widget.text)} /></div>;
  if (widget.type === 'decorated') {
    const href = safeHref(widget.url);
    return (
      <div className="pw-gchat__card-decorated">
        {widget.topLabel ? <span data-no-translate="" className="pw-gchat__muted">{widget.topLabel}</span> : null}
        {href ? <a data-no-translate="" href={href} target="_blank" rel="noopener noreferrer">{widget.text}</a> : <span data-no-translate="">{widget.text}</span>}
        {widget.bottomLabel ? <span data-no-translate="" className="pw-gchat__muted">{widget.bottomLabel}</span> : null}
      </div>
    );
  }
  if (widget.type === 'buttons') {
    return (
      <div className="pw-gchat__card-buttons">
        {widget.buttons.map((button, index) => {
          const href = safeHref(button.url);
          // eslint-disable-next-line react/no-array-index-key
          const key = `${button.text}-${index}`;
          return href ? (
            <Button key={key} variant="secondary" icon="open_in_new" href={href} target="_blank" rel="noopener noreferrer">
              <span data-no-translate="">{button.text}</span>
            </Button>
          ) : (
            <Button key={key} variant="secondary" disabled tooltip="Tombol aplikasi ini hanya berjalan di Google Chat"><span data-no-translate="">{button.text}</span></Button>
          );
        })}
      </div>
    );
  }
  return null;
}

export default function MessageCards({ cards }) {
  if (!cards?.length) return null;
  return (
    <div className="pw-gchat__cards">
      {cards.map((card, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <article key={index} className="pw-gchat__card" aria-label={card.header?.title || 'Kartu aplikasi'} data-no-translate={card.header?.title ? 'attr' : undefined}>
          {card.header ? (
            <header className="pw-gchat__card-head">
              {card.header.title ? <span data-no-translate="" className="pw-gchat__card-title">{card.header.title}</span> : null}
              {card.header.subtitle ? <span data-no-translate="" className="pw-gchat__muted">{card.header.subtitle}</span> : null}
            </header>
          ) : null}
          {card.sections.map((section, s) => (
            // eslint-disable-next-line react/no-array-index-key
            <section key={s} className="pw-gchat__card-section">
              {section.header ? <h4 data-no-translate="" className="pw-gchat__card-section-title">{section.header}</h4> : null}
              {section.widgets.map((widget, w) => <Widget key={`${widget.type}-${w}`} widget={widget} />)}
            </section>
          ))}
        </article>
      ))}
    </div>
  );
}
