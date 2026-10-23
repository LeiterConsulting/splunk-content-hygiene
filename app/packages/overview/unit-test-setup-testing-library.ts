/*
 * Setup testing-library for react and jest-dom matchers
 * This file needs to be included in tsconfig for the types from @testing-library/jest-dom
 * to get picked up. See: https://github.com/testing-library/jest-dom#usage
 */
import '@testing-library/jest-dom';
import { TextEncoder } from 'util';

Object.assign(globalThis, { TextEncoder });

// Evidence fixtures use explicit July windows; keep freshness tests repeatable.
beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-28T12:00:00Z')); });
afterEach(() => { jest.restoreAllMocks(); });
