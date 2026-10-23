import { useEffect, useState } from 'react';

// Expiry remains truthful in long-lived tabs, without re-fetching customer data.
export function useEvidenceClock(): number {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const refresh = (): void => setNow(Date.now());
        const interval = window.setInterval(refresh, 60000);
        window.addEventListener('focus', refresh);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener('focus', refresh);
        };
    }, []);
    return now;
}
