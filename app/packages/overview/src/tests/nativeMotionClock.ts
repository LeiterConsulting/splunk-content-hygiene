// Test-only clock for the real animation engine already used by Splunk UI.
// rafz captures requestAnimationFrame at import time, so install/restore the
// clock through its supported scheduler hook as well as Jest's timer clock.
import { act } from '@testing-library/react';
import { raf } from '@react-spring/rafz';

export function nativeMotionClock(): { settle: () => Promise<void>; restore: () => void } {
    const originalFrame = window.requestAnimationFrame;
    jest.useFakeTimers();
    raf.use(window.requestAnimationFrame);
    return {
        settle: async () => {
            // Flush React between frames, retaining actual SUI spring/opacity,
            // focus management and dismissal rather than mocking the Modal.
            for (let frame = 0; frame < 100; frame += 1) {
                // eslint-disable-next-line no-await-in-loop -- Each animation frame must commit before advancing the next.
                await act(async () => { await jest.advanceTimersByTimeAsync(16); });
            }
        },
        restore: () => { jest.useRealTimers(); raf.use(originalFrame); },
    };
}
