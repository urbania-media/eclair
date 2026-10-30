import { describe, expect, it } from 'vitest';

import { ProgressThrottle } from './progress.ts';

describe('ProgressThrottle', () => {
    function clock() {
        const time = { now: 0 };
        return { time, now: () => time.now };
    }

    it('waits for the interval from the start of the task', () => {
        const { time, now } = clock();
        const throttle = new ProgressThrottle(5000, now);

        time.now = 4999;
        expect(throttle.accept(0.1)).toBe(false);
        time.now = 5000;
        expect(throttle.accept(0.2)).toBe(true);
    });

    it('sends at most once per interval', () => {
        const { time, now } = clock();
        const throttle = new ProgressThrottle(5000, now);

        time.now = 5000;
        expect(throttle.accept(0.2)).toBe(true);
        time.now = 9000;
        expect(throttle.accept(0.3)).toBe(false);
        time.now = 10_000;
        expect(throttle.accept(0.4)).toBe(true);
    });

    it('skips a progress that did not change', () => {
        const { time, now } = clock();
        const throttle = new ProgressThrottle(1000, now);

        time.now = 1000;
        expect(throttle.accept(0.5)).toBe(true);
        time.now = 2000;
        expect(throttle.accept(0.5)).toBe(false);
        time.now = 3000;
        expect(throttle.accept(0.6)).toBe(true);
    });
});
