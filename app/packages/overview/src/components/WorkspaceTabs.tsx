import React, { Children, isValidElement, useId, useState } from 'react';
import TabBar from '@splunk/react-ui/TabBar';
import { WorkspacePanel } from '../AppStyles';

interface PanelProps {
    panelId: string;
    label: React.ReactNode;
    count?: number;
    inset?: boolean;
    children?: React.ReactNode;
}

function Panel(_props: PanelProps): null { return null; }

/** Native tab navigation with persistent panels: inspecting evidence never resets a draft. */
export function WorkspaceTabs({ children, activePanelId, defaultActivePanelId, onChange }: {
    children: React.ReactNode;
    activePanelId?: string;
    defaultActivePanelId?: string;
    onChange?: (event: React.MouseEvent<HTMLButtonElement> | React.FocusEvent<HTMLButtonElement>, data: { activePanelId?: string }) => void;
}): React.ReactElement {
    const id = useId();
    const panels = Children.toArray(children).filter(isValidElement) as React.ReactElement<PanelProps>[];
    const [localId, setLocalId] = useState(defaultActivePanelId ?? panels[0]?.props.panelId);
    const active = activePanelId ?? localId;
    return <>
        <TabBar activeTabId={active} onChange={(event, data) => {
            setLocalId(data.selectedTabId ?? active);
            onChange?.(event, { activePanelId: data.selectedTabId });
        }}>
            {panels.map((panel) => <TabBar.Tab key={panel.props.panelId} tabId={panel.props.panelId}
                id={`${id}-${panel.props.panelId}-tab`} ariaControls={`${id}-${panel.props.panelId}`}
                label={panel.props.label} count={panel.props.count} />)}
        </TabBar>
        {panels.map((panel) => <WorkspacePanel key={panel.props.panelId} id={`${id}-${panel.props.panelId}`}
            role="tabpanel" aria-labelledby={`${id}-${panel.props.panelId}-tab`} hidden={panel.props.panelId !== active}
            style={panel.props.inset === false ? { padding: 0 } : undefined}>
            {panel.props.children}
        </WorkspacePanel>)}
    </>;
}
WorkspaceTabs.Panel = Panel;
