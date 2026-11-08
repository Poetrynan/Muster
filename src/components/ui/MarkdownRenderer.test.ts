import { expect,it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownRenderer } from './MarkdownRenderer';
it('renders untrusted guide citations as text when links are disabled',()=>{const html=renderToStaticMarkup(createElement(MarkdownRenderer,{content:'[Assessment](https://example.test/fake)',allowLinks:false}));expect(html).toContain('Assessment');expect(html).not.toContain('<a');expect(html).not.toContain('href');});
