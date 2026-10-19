import { describe, expect, it } from 'vitest';
import { normalizePaintingUrl, paintingGuideHtml, paintingGuideLink } from './link';

describe('painting guide links', () => {
	it('accepts an http(s) URL and a YouTube channel address', () => {
		expect(normalizePaintingUrl('  https://www.youtube.com/@rustpainter  ')).toBe('https://www.youtube.com/@rustpainter');
		expect(normalizePaintingUrl('http://blog.example/guide')).toBe('http://blog.example/guide');
		expect(normalizePaintingUrl('')).toBe('');
		expect(normalizePaintingUrl('   ')).toBe('');
		const guide = paintingGuideLink('https://youtu.be/abc123');
		expect(guide).toMatchObject({ domain: 'youtube.com', youtube: true, label: 'Painting guide on youtube.com' });
		expect(paintingGuideLink('https://notes.example/cars')?.label).toBe('Painting guide on notes.example');
		expect(paintingGuideLink('https://notes.example/cars')?.youtube).toBe(false);
	});

	it('rejects anything that is not a plain http(s) link', () => {
		expect(() => normalizePaintingUrl('javascript:alert(1)')).toThrow(/http/);
		expect(() => normalizePaintingUrl('ada@example.com')).toThrow(/http/);
		expect(() => normalizePaintingUrl('https://user:pass@example.com/secret')).toThrow(/http/);
		expect(() => normalizePaintingUrl(`https://example.com/${'a'.repeat(300)}`)).toThrow(/300/);
		expect(paintingGuideLink('javascript:alert(1)')).toBeNull();
		expect(paintingGuideLink('')).toBeNull();
	});

	it('escapes the href and omits a blank or unsafe link', () => {
		const html = paintingGuideHtml('https://example.com/?q=1&x=2');
		expect(html).toContain('href="https://example.com/?q=1&amp;x=2"');
		expect(html).toContain('rel="nofollow ugc noopener noreferrer"');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('Painting guide on example.com');
		expect(html).not.toContain('<script');
		const youtube = paintingGuideHtml('https://www.youtube.com/@rustpainter"><script>');
		expect(youtube).toBe('');
		expect(paintingGuideHtml('https://www.youtube.com/@rustpainter')).toContain('Painting guide on youtube.com');
		expect(paintingGuideHtml('https://www.youtube.com/@rustpainter')).toContain('fill="#FF0033"');
		expect(paintingGuideHtml('')).toBe('');
	});
});
