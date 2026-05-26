import { describe, it, expect } from 'vitest';
import { detectLanguageFromName } from './languageDetection';

describe('languageDetection', () => {
  it('detects JSON from .json extension', () => {
    expect(detectLanguageFromName('config.json')).toBe('json');
  });

  it('detects shell from .sh extension', () => {
    expect(detectLanguageFromName('script.sh')).toBe('shell');
  });

  it('detects JavaScript from .js extension', () => {
    expect(detectLanguageFromName('main.js')).toBe('javascript');
  });

  it('detects TypeScript from .ts extension', () => {
    expect(detectLanguageFromName('app.ts')).toBe('typescript');
  });

  it('detects Python from .py extension', () => {
    expect(detectLanguageFromName('script.py')).toBe('python');
  });

  it('detects SQL from .sql extension', () => {
    expect(detectLanguageFromName('query.sql')).toBe('sql');
  });

  it('detects HTML from .html extension', () => {
    expect(detectLanguageFromName('index.html')).toBe('html');
  });

  it('detects CSS from .css extension', () => {
    expect(detectLanguageFromName('style.css')).toBe('css');
  });

  it('detects XML from .xml extension', () => {
    expect(detectLanguageFromName('data.xml')).toBe('xml');
  });

  it('defaults to plaintext for no extension', () => {
    expect(detectLanguageFromName('README')).toBe('plaintext');
  });

  it('defaults to plaintext for unknown extension', () => {
    expect(detectLanguageFromName('file.unknown')).toBe('plaintext');
  });

  it('handles uppercase extensions (.JSON)', () => {
    expect(detectLanguageFromName('CONFIG.JSON')).toBe('json');
  });

  it('handles multiple dots in filename (my.config.json)', () => {
    expect(detectLanguageFromName('my.config.json')).toBe('json');
  });
});
