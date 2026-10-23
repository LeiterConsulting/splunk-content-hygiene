import { createContext } from 'react';
import { ReviewHistoryPage, ReviewRecord } from '../types';

export interface ReviewWorkflow {
    states: ReadonlyMap<string, ReviewRecord>;
    reload?: (objectId: string) => Promise<ReviewRecord | null>;
    refresh?: () => Promise<void>;
    history?: (objectId: string, before?: number) => Promise<ReviewHistoryPage>;
}

export const ReviewWorkflowContext = createContext<ReviewWorkflow>({ states: new Map() });
