import React from 'react';
import Dropdown from '@splunk/react-ui/Dropdown';
import Menu from '@splunk/react-ui/Menu';
import { StyledButton } from '../AppStyles';

export function ExportMenu({ label, disabled, items }: {
    label: string;
    disabled?: boolean;
    items: { label: string; onClick: () => void; disabled?: boolean }[];
}): React.ReactElement {
    return <Dropdown toggle={<StyledButton isMenu disabled={disabled}>{label}</StyledButton>}>
        <Menu style={{ minWidth: 220, maxWidth: 'calc(100vw - 32px)' }}>
            {items.map((item) => <Menu.Item key={item.label} disabled={item.disabled}
                onClick={item.onClick}>{item.label}</Menu.Item>)}
        </Menu>
    </Dropdown>;
}
