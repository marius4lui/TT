import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../apps/worker/src/pages';

const options = {
  botName: 'TT <script>alert(1)</script>',
  infoText: 'Training <img src=x onerror=alert(1)>\nAm Freitag',
  privacyText: 'Verantwortlich: <svg onload=alert(1)>\nKontakt',
  botNumber: '+49 123 456',
  origin: 'https://tt.example.test',
};

describe('public and trainer web pages', () => {
  it('escapes configured text before inserting it in the public shell', () => {
    const html = renderPage('/info', options)!;
    expect(html).toContain('TT &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Training &lt;img src=x onerror=alert(1)&gt;<br>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain(options.origin);
  });

  it('publishes the data-free trainer shell and the complete accessible workflows', () => {
    const html = renderPage('/trainer', options)!;
    for (const marker of [
      'data-trainer',
      'data-view-panel="overview"',
      'data-form="single-session"',
      'data-form="series"',
      'data-form="pause"',
      'data-form="settings-privacy"',
      'data-form="activation"',
      'data-form="summary-preference"',
      'data-form="group-request"',
      'data-owner-only',
      'data-exception-list',
      'data-move-dialog',
      'role="alert"',
      'aria-label="Trainerbereiche"',
    ])
      expect(html).toContain(marker);
    expect(html).not.toContain('tt.example.test');
    expect(html).not.toContain('data-session="');
  });

  it('keeps magic-link redemption behind a user action and avoids unsafe HTML sinks or token storage', () => {
    const html = renderPage('/login', options)!;
    const script = readFileSync(new URL('../apps/web/public/app.js', import.meta.url), 'utf8');
    expect(html).toContain('data-action="magic-finish"');
    expect(html).toContain('data-login-state="preview"');
    expect(script).toContain("post('/api/v1/auth/magic/preview'");
    expect(script).toContain("post('/api/v1/auth/magic/finish'");
    expect(script).toContain("finish.addEventListener('click'");
    expect(script).toContain("history.replaceState(null, ''");
    expect(script).not.toMatch(/\b(?:localStorage|sessionStorage)\b/);
    expect(script).not.toMatch(/\.innerHTML\s*=/);
    expect(script).not.toMatch(/\b(?:alert|prompt|confirm)\s*\(/);
  });

  it('keeps the four primary navigation controls accessible and editing out of the overview', () => {
    const html = renderPage('/trainer', options)!;
    const nav = html.match(/<nav class="trainer-nav"[\s\S]*?<\/nav>/)![0];
    expect([...nav.matchAll(/role="tab"/g)]).toHaveLength(4);
    for (const name of ['overview', 'sessions', 'requests', 'more']) {
      expect(nav).toContain(`aria-controls="panel-${name}"`);
      expect(html).toContain(`id="panel-${name}"`);
    }
    const overview = html.slice(
      html.indexOf('id="panel-overview"'),
      html.indexOf('id="panel-sessions"'),
    );
    expect(overview).toContain('data-next-training');
    expect(overview).not.toContain('<form');
    expect(html).toContain('data-attendance-panel');
    expect(html).toContain('viewport-fit=cover');
  });

  it('places every trainer editor inside the delegated event boundary with unique dialog labels', () => {
    const html = renderPage('/trainer', options)!;
    const rootStart = html.indexOf('data-trainer aria-busy');
    const rootEnd = html.lastIndexOf('</section>');
    for (const name of ['session', 'series', 'pause']) {
      const position = html.indexOf(`data-editor="${name}"`);
      expect(position).toBeGreaterThan(rootStart);
      expect(position).toBeLessThan(rootEnd);
      expect(html).toContain(`aria-labelledby="editor-${name}"`);
      expect(html).toContain(`id="editor-${name}"`);
    }
    expect(html.indexOf('data-move-dialog')).toBeLessThan(rootEnd);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('renders long information as escaped paragraphs instead of a single preformatted block', () => {
    const html = renderPage('/info', {
      ...options,
      infoText: 'Erster Absatz.\nNoch eine Zeile.\n\nZweiter Absatz mit <b>Text</b>.',
    })!;
    expect(html).toContain('<p>Erster Absatz.<br>\nNoch eine Zeile.</p>');
    expect(html).toContain('<p>Zweiter Absatz mit &lt;b&gt;Text&lt;/b&gt;.</p>');
    expect(html).not.toContain('<pre');
  });

  it('returns no page for unknown paths and strips trailing slashes', () => {
    expect(renderPage('/unknown', options)).toBeNull();
    expect(renderPage('/trainer/', options)).toContain('data-trainer');
  });
});
