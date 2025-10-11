const assert = require('assert');
const { buildSocketErrorPayload, emitSocketError } = require('../utils/socketErrors');

describe('socketErrors helper', () => {
  it('buildSocketErrorPayload normalizes code and preserves legacy fields', () => {
    const payload = buildSocketErrorPayload('validation_error', 'Something went wrong', {
      source: 'unit:test',
      context: { field: 'bookingId' },
      details: { missing: ['bookingId'] },
      retryable: true,
      extras: { bookingId: 'abc123' }
    });

    assert.strictEqual(payload.code, 'VALIDATION_ERROR');
    assert.strictEqual(payload.message, 'Something went wrong');
    assert.strictEqual(payload.source, 'unit:test');
    assert.strictEqual(payload.bookingId, 'abc123');
    assert.ok(payload.error);
    assert.strictEqual(payload.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(payload.error.message, 'Something went wrong');
    assert.strictEqual(payload.error.source, 'unit:test');
    assert.deepStrictEqual(payload.error.context, { field: 'bookingId' });
    assert.deepStrictEqual(payload.error.details, { missing: ['bookingId'] });
    assert.strictEqual(payload.error.retryable, true);
    assert.ok(payload.error.timestamp);
  });

  it('emitSocketError emits payload to provided socket', () => {
    const events = [];
    const fakeSocket = {
      emit(event, data) {
        events.push({ event, data });
      }
    };

    const payload = emitSocketError(fakeSocket, 'booking_error', 'not_found', 'Booking not found', {
      source: 'unit:test',
      extras: { bookingId: 'xyz789' }
    });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].event, 'booking_error');
    assert.deepStrictEqual(events[0].data, payload);
    assert.strictEqual(payload.code, 'NOT_FOUND');
    assert.strictEqual(payload.message, 'Booking not found');
    assert.strictEqual(payload.error.code, 'NOT_FOUND');
    assert.strictEqual(payload.bookingId, 'xyz789');
  });
});
