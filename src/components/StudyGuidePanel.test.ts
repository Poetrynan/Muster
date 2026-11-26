import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { StudyGuidePanel } from './StudyGuidePanel';

vi.mock('../services/idbStorage', () => ({ idbStorage: { getItem: () => null } }));

it('shows only the four action-oriented shortcut prompts', () => {
    const html = renderToStaticMarkup(createElement(StudyGuidePanel, {
        course: { id: 10, shortName: 'FIT5201', fullName: 'FIT5201 S2 2026', category: '', visible: true },
    }));
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    for (const label of [
        'What should I do first?', 'What changed in the notices?',
        'Break down this assessment', 'What should I improve next time?',
    ]) {
        expect(html).toContain(label);
    }
});
