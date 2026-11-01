import {
  nextCountedCallAt, parseDay, parseReply, requiredCalls, signLink, spacedCallCount, verifyLink,
} from '../src/modules/delivery-integrity/integrity.util';
import { parseWhatsAppWebhook } from '../src/modules/delivery-integrity/public.controllers';
import { mapTwilioStatus, twilioSignature, verifyTwilioSignature } from '../src/modules/delivery-integrity/call-providers';
import { addressSimilarity } from '../src/modules/address-book/address-book.service';

/** Pure delivery-integrity helpers: reply intents, signed links, call spacing, webhook parsing. */
describe('Delivery integrity — helpers', () => {
  const today = '2026-11-01'; // a Sunday

  it.each([
    ['1', 'YES'], ['١', 'YES'], ['نعم', 'YES'], ['أيوه', 'YES'], ['اييييوه', 'YES'], ['تمام', 'YES'], ['أكد', 'YES'], ['اكيد يا فندم', 'YES'], ['ok', 'YES'], ['Yes please', 'YES'], ['aywa', 'YES'],
    ['2', 'CHANGE'], ['٢', 'CHANGE'], ['غيروا الميعاد', 'CHANGE'], ['ممكن بكره', 'CHANGE'], ['reschedule', 'CHANGE'],
    ['3', 'CANCEL'], ['٣', 'CANCEL'], ['الغي', 'CANCEL'], ['إلغاء', 'CANCEL'], ['مش عايز الاوردر', 'CANCEL'], ['cancel', 'CANCEL'], ['elghi', 'CANCEL'],
    ['لا', 'NO'], ['لأ مش صحيح', 'NO'], ['no', 'NO'], ['محدش جه', 'NO'],
    ['مين معايا', 'UNKNOWN'], ['', 'UNKNOWN'], ['12345', 'UNKNOWN'],
  ])('parses %p as %s', (text, kind) => {
    expect(parseReply(text, today).kind).toBe(kind);
  });

  it('reads the requested day from change-day replies', () => {
    expect(parseReply('2', today)).toMatchObject({ kind: 'CHANGE', option: 2 });
    expect(parseReply('٢ بكره', today).date).toBe('2026-11-02');
    expect(parseDay('بعد بكرة', today)).toBe('2026-11-03');
    expect(parseDay('يوم الخميس', today)).toBe('2026-11-05');
    expect(parseDay('sunday', today)).toBe('2026-11-08'); // next one, not today
    expect(parseDay('5/11', today)).toBe('2026-11-05');
    expect(parseDay('3/1', today)).toBe('2027-01-03');
    expect(parseDay('2026-11-04', today)).toBe('2026-11-04');
    expect(parseDay('whenever', today)).toBeUndefined();
  });

  it('signs customer links per tracking number, scope, subject and expiry', () => {
    const tn = 'GT1234567897';
    const now = Date.now();
    const token = signLink(tn, 'confirm', 3_600_000, '', now);
    expect(token).toMatch(/^c[0-9a-z]+\.[A-Za-z0-9_-]{22}$/);
    expect(verifyLink(token, tn, 'confirm', '', now)).toMatchObject({ ok: true });
    expect(verifyLink(token, 'GT1234567880', 'confirm', '', now)).toEqual({ ok: false, reason: 'INVALID' });
    expect(verifyLink(token, tn, 'pin', '', now)).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(verifyLink(token, tn, 'confirm', '', now + 2 * 3_600_000)).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(verifyLink(`${token.slice(0, -1)}A`, tn, 'confirm', '', now).ok).toBe(false);
    expect(verifyLink(null, tn, 'confirm').ok).toBe(false);
    const attempt = signLink(tn, 'attempt', 3_600_000, 'attempt-1', now);
    expect(verifyLink(attempt, tn, 'attempt', 'attempt-1', now).ok).toBe(true);
    expect(verifyLink(attempt, tn, 'attempt', 'attempt-2', now).ok).toBe(false);
  });

  it('counts only calls inside the window and spaced apart', () => {
    const now = Date.now();
    const min = (m: number) => new Date(now - m * 60_000);
    expect(spacedCallCount([min(1), min(1.1), min(1.2)], 3, now)).toBe(1);
    expect(spacedCallCount([min(10), min(6), min(1)], 3, now)).toBe(3);
    expect(spacedCallCount([min(10), min(9), min(6)], 3, now)).toBe(2);
    expect(spacedCallCount([min(130), min(5)], 3, now)).toBe(1); // older than 2 h
    expect(nextCountedCallAt([min(1)], 3, now)!.getTime()).toBe(now + 2 * 60_000);
    expect(nextCountedCallAt([min(5)], 3, now)).toBeNull();
    expect(requiredCalls('CUSTOMER_UNREACHABLE', true, 2)).toBe(2);
    expect(requiredCalls('CUSTOMER_REFUSED', true, 2)).toBe(0);
    expect(requiredCalls('CUSTOMER_REFUSED', false, 2)).toBe(1);
    expect(requiredCalls('CUSTOMER_NOT_PRESENT', false, 0)).toBe(1);
  });

  it('parses WhatsApp Cloud API text, button, interactive and location messages', () => {
    const body = {
      entry: [{ changes: [{ value: {
        statuses: [{ id: 'wamid.status', status: 'delivered' }],
        messages: [
          { from: '201001234567', id: 'a', type: 'text', text: { body: '1' } },
          { from: '201001234567', id: 'b', type: 'button', button: { text: 'Confirm', payload: 'CONFIRM' } },
          { from: '201001234567', id: 'c', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'DISPUTE', title: 'لا' } } },
          { from: '201001234567', id: 'd', type: 'location', location: { latitude: 30.05, longitude: 31.34, name: 'Home' } },
          { from: '201001234567', id: 'e', type: 'image' },
        ],
      } }] }],
    };
    expect(parseWhatsAppWebhook(body)).toEqual([
      expect.objectContaining({ providerMessageId: 'a', text: '1', channel: 'WHATSAPP' }),
      expect.objectContaining({ providerMessageId: 'b', text: 'CONFIRM' }),
      expect.objectContaining({ providerMessageId: 'c', text: 'DISPUTE' }),
      expect.objectContaining({ providerMessageId: 'd', location: { lat: 30.05, lng: 31.34 } }),
      expect.objectContaining({ providerMessageId: 'e', text: null }),
    ]);
    expect(parseWhatsAppWebhook({})).toEqual([]);
    expect(parseReply('DISPUTE', today).kind).toBe('NO');
  });

  it('verifies Twilio signatures and maps call statuses', () => {
    // Example from Twilio's webhook security docs.
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
    expect(twilioSignature('12345', url, params)).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
    expect(verifyTwilioSignature('12345', url, params, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')).toBe(true);
    expect(verifyTwilioSignature('12345', url, { ...params, Digits: '9' }, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')).toBe(false);
    expect(mapTwilioStatus('completed')).toBe('ANSWERED');
    expect(mapTwilioStatus('no-answer')).toBe('NO_ANSWER');
    expect(mapTwilioStatus('busy')).toBe('BUSY');
    expect(mapTwilioStatus('canceled')).toBe('FAILED');
    expect(mapTwilioStatus('whatever')).toBeNull();
  });

  it('compares addresses by their meaningful words (Arabic, English, Franco)', () => {
    expect(addressSimilarity({ line: '14 Abbas El Akkad St, Nasr City' }, { line: '14 abbas el-akkad street, nasr city' })).toBe(1);
    expect(addressSimilarity({ line: '١٤ شارع عباس العقاد، مدينة نصر' }, { line: '14 عباس العقاد مدينه نصر' })).toBe(1);
    expect(addressSimilarity({ line: '14 Abbas El Akkad, Nasr City' }, { line: 'Makram Ebeid, City Stars, Nasr City' })).toBeLessThan(0.6);
  });
});
