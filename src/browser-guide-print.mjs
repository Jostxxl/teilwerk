// Reserve the tab during the user's click, before async geometry preparation.
export function reserveBrowserGuideWindow(host = window) {
  const tab = host.open('about:blank', '_blank');
  if (!tab) throw new Error('Bitte das Öffnen der Montageanleitung in einem neuen Tab erlauben oder die HTML-Anleitung herunterladen.');
  tab.document.title = 'Montageanleitung · Teilwerk';
  tab.document.body.textContent = 'Montageanleitung wird auf deinem Rechner erstellt …';
  return {
    close() { tab.close(); },
    show(html) {
      if (tab.closed) throw new Error('Der Tab für die Montageanleitung wurde geschlossen. Bitte erneut öffnen.');
      tab.document.open();
      // The guide is self-contained. Even embedded model notes cannot initiate
      // a network request from this print preview.
      const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data:; form-action \'none\'; base-uri \'none\'">';
      tab.document.write(html.replace(/<head>/i, '<head>' + policy));
      tab.document.close();
      tab.document.querySelectorAll('button.print').forEach(button => button.remove());
      const toolbar = tab.document.createElement('div');
      toolbar.className = 'studio-browser-print';
      const button = tab.document.createElement('button');
      button.textContent = 'Drucken / als PDF speichern';
      button.addEventListener('click', () => tab.print());
      const note = tab.document.createElement('span');
      note.textContent = 'Im Druckdialog „Als PDF speichern“ wählen. Hintergrundgrafiken aktivieren, Kopf- und Fußzeilen ausschalten.';
      toolbar.append(button, note);
      const style = tab.document.createElement('style');
      style.textContent = '.studio-browser-print{position:sticky;top:0;z-index:100;padding:14px;background:#171717;color:#fff;display:flex;gap:16px;align-items:center;font:14px Arial;flex-wrap:wrap}.studio-browser-print button{border:0;border-radius:5px;background:#f59f27;color:#111;padding:12px 18px;cursor:pointer;font-weight:bold}@media print{.studio-browser-print{display:none!important}}';
      tab.document.head.append(style);
      tab.document.body.prepend(toolbar);
      tab.focus();
    },
  };
}
