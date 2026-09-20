const assert = require('node:assert/strict');
const { test } = require('node:test');

function extract(input) { return require('../../dist/src/telegram/ioc-extractor.js').extractIocs(input); }

test('Given supported IOC values, when extracted, then each type is normalized', () => {
  const values = extract({ text: '8.8.8.8 2001:4860:4860::8888 Example.COM. hxxps://evil[.]example/a d41d8cd98f00b204e9800998ecf8427e 0123456789012345678901234567890123456789 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  const byType = new Map(values.map(value => [value.type, value.normalizedValue]));
  assert.equal(byType.get('IPV4'), '8.8.8.8');
  assert.equal(byType.get('IPV6'), '2001:4860:4860::8888');
  assert.equal(byType.get('DOMAIN'), 'example.com');
  assert.equal(byType.get('URL'), 'https://evil.example/a');
  assert.equal(byType.get('MD5'), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(byType.get('SHA1'), '0123456789012345678901234567890123456789');
  assert.equal(byType.get('SHA256'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
});

test('Given defanged domains and URLs, when extracted, then brackets and hxxp are canonicalized', () => {
  const values = extract({ caption: 'hxxp://Bad[.]Example.:80/path and second(.)example' });
  assert.ok(values.some(value => value.type === 'URL' && value.normalizedValue === 'http://bad.example/path'));
  assert.ok(values.some(value => value.type === 'DOMAIN' && value.normalizedValue === 'second.example'));
});

test('Given Telegram entities, when extracted, then entity method and span are retained', () => {
  const [value] = extract({ text: 'click here', entities: [{ type: 'text_link', offset: 0, length: 5, url: 'https://entity.example/path' }] });
  assert.equal(value.extractionMethod, 'ENTITY');
  assert.equal(value.spanStart, 0); assert.equal(value.spanEnd, 5);
});

test('Given invalid IOC values, when extracted, then they are rejected', () => {
  assert.deepEqual(extract({ text: '999.999.999.999 example invalidhash123 2001:db8:::1' }), []);
});

test('Given a private or documentation IP, when extracted, then confidence is explicitly low', () => {
  const values = extract({ text: '10.0.0.1 192.0.2.1 2001:db8::1' });
  assert.ok(values.length >= 3); assert.ok(values.every(value => value.confidence === 30));
});
