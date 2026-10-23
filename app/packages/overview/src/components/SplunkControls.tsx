import React, { Children, isValidElement, useId } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import SelectControl from '@splunk/react-ui/Select';
import Text from '@splunk/react-ui/Text';
import TextAreaControl from '@splunk/react-ui/TextArea';
import TableControl from '@splunk/react-ui/Table';
import Message from '@splunk/react-ui/Message';

interface ValueChange {
    currentTarget: { value: string };
}
interface ValueProps {
    value?: string | number;
    onChange?: (change: ValueChange) => void;
}

export function ActionButton({
    $primary,
    disabled,
    ...props
}: React.ComponentProps<typeof Button> & { $primary?: boolean }): React.ReactElement {
    return (
        <Button
            {...props}
            appearance={$primary ? 'primary' : (props.appearance ?? 'secondary')}
            disabled={disabled ? 'disabled' : false}
        />
    );
}
export function TextControl({
    value,
    onChange,
    ...props
}: Omit<React.ComponentProps<typeof Text>, 'value' | 'onChange' | 'defaultValue'> &
    ValueProps): React.ReactElement {
    return (
        <Text
            {...props}
            value={String(value ?? '')}
            onChange={(_event, data) => onChange?.({ currentTarget: { value: data.value } })}
        />
    );
}
export function NotesControl({
    value,
    onChange,
    ...props
}: Omit<React.ComponentProps<typeof TextAreaControl>, 'value' | 'onChange' | 'defaultValue'> &
    ValueProps): React.ReactElement {
    return (
        <TextAreaControl
            {...props}
            value={String(value ?? '')}
            rowsMin={4}
            onChange={(_event, data) => onChange?.({ currentTarget: { value: data.value } })}
        />
    );
}

function flatten(children: React.ReactNode): React.ReactElement[] {
    const result: React.ReactElement[] = [];
    Children.forEach(children, (child) => {
        if (!isValidElement(child)) {
            return;
        }
        if (child.type === React.Fragment) {
            result.push(...flatten(child.props.children));
        } else {
            result.push(child);
        }
    });
    return result;
}

// Select renders its filter in a portal outside the workspace root. Give only
// our filter inputs a stable styling hook so legacy dashboard CSS cannot paint
// a white surface behind dark-theme placeholder text. Native host inputs are
// intentionally not tagged or restyled.
function scopeFilterInput(input: HTMLInputElement | null): void {
    input?.setAttribute('data-content-hygiene-filter', 'true');
}

/** Translate the existing option declarations into actual Splunk Select options. */
export function ChoiceControl({
    value,
    onChange,
    children,
    inputId,
    ...props
}: Omit<
    React.ComponentProps<typeof SelectControl>,
    'value' | 'onChange' | 'children' | 'defaultValue' | 'inputRef'
> &
    ValueProps & { children?: React.ReactNode }): React.ReactElement {
    const options = flatten(children);
    // SUI 5.12 reuses inputId for toggle and filter. An id on the toggle keeps
    // the visible label connected without giving the filter a duplicate ID.
    return (
        <SelectControl
            {...props}
            id={inputId ?? props.id}
            inputRef={scopeFilterInput}
            inline={false}
            filter={options.length > 8}
            repositionMode="flip"
            menuStyle={{ maxWidth: 'calc(100vw - 32px)', maxHeight: 'min(50vh, 400px)' }}
            value={String(value ?? options[0]?.props.value ?? '')}
            onChange={(_event, data) =>
                onChange?.({ currentTarget: { value: String(data.value) } })
            }
        >
            {options.map((option, index) => (
                <SelectControl.Option
                    key={option.key ?? index}
                    value={String(option.props.value ?? '')}
                    label={Children.toArray(option.props.children)
                        .join('')
                        .replace(/\s+/g, ' ')
                        .trim()}
                    disabled={option.props.disabled}
                    description={option.props['data-description']}
                    descriptionPosition="bottom"
                    truncate={false}
                    style={{ overflowWrap: 'anywhere' }}
                />
            ))}
        </SelectControl>
    );
}

export function FieldControl({
    children,
    className,
}: {
    children?: React.ReactNode;
    className?: string;
}): React.ReactElement {
    const id = useId();
    const items = Children.toArray(children);
    const label = items
        .filter((item) => typeof item === 'string' || typeof item === 'number')
        .join('')
        .trim();
    return (
        <ControlGroup
            className={className}
            label={label}
            labelFor={id}
            labelPosition="top"
            controlsLayout="stack"
        >
            {items
                .filter(isValidElement)
                .map((item) => React.cloneElement(item as React.ReactElement, { inputId: id }))}
        </ControlGroup>
    );
}

// Keep existing column declarations while letting Splunk own table behavior,
// semantics, focus, and scrolling. Rendering is bounded by each page's paginator.
export function DataTable({
    children,
    className,
}: {
    children?: React.ReactNode;
    className?: string;
}): React.ReactElement {
    const groups = flatten(children);
    const heads = groups
        .filter((group) => group.type === 'thead')
        .flatMap((group) => flatten(group.props.children));
    const bodies = groups
        .filter((group) => group.type === 'tbody')
        .flatMap((group) => flatten(group.props.children));
    return (
        <TableControl
            className={className}
            stripeRows
            horizontalOverflow="scroll"
            headType="inline"
        >
            <TableControl.Head>
                {heads
                    .flatMap((row) => flatten(row.props.children))
                    .map((cell, index) => (
                        <TableControl.HeadCell key={cell.key ?? index} truncate={false}>
                            {cell.props.children}
                        </TableControl.HeadCell>
                    ))}
            </TableControl.Head>
            <TableControl.Body>
                {bodies.map((row, index) => (
                    <TableControl.Row key={row.key ?? index}>
                        {flatten(row.props.children).map((cell, cellIndex) => (
                            <TableControl.Cell key={cell.key ?? cellIndex}>
                                <div data-content-hygiene-cell style={{ minWidth: 0 }}>
                                    {cell.props.children}
                                </div>
                            </TableControl.Cell>
                        ))}
                    </TableControl.Row>
                ))}
            </TableControl.Body>
        </TableControl>
    );
}

export function Notice({
    role,
    ...props
}: React.ComponentProps<typeof Message>): React.ReactElement {
    return (
        <Message
            {...props}
            role={role}
            appearance="fill"
            type={role === 'alert' ? 'error' : (props.type ?? 'info')}
        />
    );
}
