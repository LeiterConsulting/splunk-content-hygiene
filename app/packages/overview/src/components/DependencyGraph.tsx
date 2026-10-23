import React, { useId, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { variables } from '@splunk/themes';
import { ButtonRow, FilterField, Select, SmallText, StyledButton } from '../AppStyles';
import {
    buildGraphModel,
    DependencyIndex,
    GRAPH_NODE_HEIGHT,
    GRAPH_NODE_WIDTH,
    graphLinkPath,
} from '../services/dependencyGraph';
import { ContentObject, DependencyEdge } from '../types';
import { StatusBadge } from './StatusBadge';

const Viewport = styled.div`
    position: relative;
    width: 100%;
    min-width: 0;
    height: min(65vh, 640px);
    min-height: 350px;
    overflow: auto;
    border: 1px solid ${variables.interactiveColorBorder};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorPage};
    overscroll-behavior: contain;
`;
const Artboard = styled.div<{ $width: number; $height: number; $zoom: number }>`
    position: relative;
    width: ${({ $width, $zoom }) => `${$width * $zoom}px`};
    height: ${({ $height, $zoom }) => `${$height * $zoom}px`};
    svg {
        position: absolute;
        inset: 0;
        overflow: visible;
        pointer-events: none;
        color: ${variables.contentColorDefault};
    }
    path {
        fill: none;
        stroke: ${variables.contentColorDefault};
        stroke-width: 2;
    }
    marker path {
        fill: ${variables.contentColorDefault};
        stroke: none;
    }
    text {
        fill: ${variables.contentColorDefault};
        font-family: inherit;
        font-size: ${variables.fontSize};
    }
    .edge-label {
        paint-order: stroke;
        stroke: ${variables.backgroundColorPage};
        stroke-width: 6px;
        stroke-linejoin: round;
        font-size: ${variables.fontSizeSmall};
    }
    .uncertain {
        stroke-dasharray: 6 4;
    }
`;
const Node = styled.div<{ $selected: boolean; $x: number; $y: number; $zoom: number }>`
    position: absolute;
    left: ${({ $x, $zoom }) => `${$x * $zoom}px`};
    top: ${({ $y, $zoom }) => `${$y * $zoom}px`};
    width: ${GRAPH_NODE_WIDTH}px;
    height: ${GRAPH_NODE_HEIGHT}px;
    box-sizing: border-box;
    transform: ${({ $zoom }) => `scale(${$zoom})`};
    transform-origin: top left;
    border: ${({ $selected }) => ($selected ? 3 : 1)}px solid
        ${({ $selected }) => ($selected ? variables.contentColorLink : variables.interactiveColorBorder)};
    border-radius: ${variables.borderRadius};
    background: ${variables.backgroundColorSection};
    padding: ${variables.spacingSmall};
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: ${variables.spacingXSmall};
    button {
        min-width: 0;
        margin: 0;
    }
`;
const NodeSelect = styled(StyledButton).attrs({ appearance: 'standalone' as const })`
    &&,
    &&:hover,
    &&:focus,
    &&:active {
        color: ${variables.contentColorLink};
        background-color: transparent;
    }
    width: 100%;
    padding: 0;
    height: auto;
    text-align: left;
    span {
        white-space: normal;
        overflow-wrap: anywhere;
    }
    .node-label {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: ${variables.spacingXSmall};
        min-width: 0;
        width: 100%;
    }
    .type {
        display: block;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .name {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
`;

export function DependencyGraph({
    center,
    index,
    edges,
    inspectedId,
    onInspect,
    allows,
}: {
    center: ContentObject;
    index: DependencyIndex;
    edges: DependencyEdge[];
    inspectedId: string;
    onInspect: (id: string) => void;
    allows: (id: string, edge: DependencyEdge) => boolean;
}): React.ReactElement {
    const [grouping, setGrouping] = useState<'app' | 'type' | 'none'>('app');
    const [expandedGroups, setExpandedGroups] = useState(new Map<string, number>());
    const [expandedNodes, setExpandedNodes] = useState(new Set<string>());
    const [zoom, setZoom] = useState(1);
    const viewport = useRef<HTMLDivElement>(null);
    const arrow = useId().replace(/:/g, '');
    const model = useMemo(
        () =>
            buildGraphModel(center.objectId, index, edges, {
                grouping,
                expandedGroups,
                expandedNodes,
                allows,
            }),
        [center.objectId, index, edges, grouping, expandedGroups, expandedNodes, allows],
    );
    const nodeById = useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model]);
    const fit = (): void => {
        setZoom(1);
        const node = nodeById.get(inspectedId) ?? nodeById.get(center.objectId);
        if (node && viewport.current) {
            viewport.current.scrollTo({
                left: Math.max(0, node.x - viewport.current.clientWidth / 2 + GRAPH_NODE_WIDTH / 2),
                top: Math.max(0, node.y - viewport.current.clientHeight / 2),
                behavior: 'smooth',
            });
        }
    };
    const columnTitle = (level: number): string => {
        if (level < 0) {
            return `Consumers · ${Math.abs(level)} hop(s)`;
        }
        return level > 0 ? `Dependencies · ${level} hop(s)` : 'Center object';
    };
    return (
        <>
            <ButtonRow>
                <FilterField>
                    Group high-degree relationships
                    <Select
                        value={grouping}
                        onChange={(event) =>
                            setGrouping(event.currentTarget.value as typeof grouping)
                        }
                    >
                        <option value="app">By app</option>
                        <option value="type">By object type</option>
                        <option value="none">Individual objects</option>
                    </Select>
                </FilterField>
                <StyledButton
                    onClick={() => setZoom((value) => Math.max(0.8, value - 0.1))}
                    disabled={zoom <= 0.8}
                    aria-label="Zoom out graph"
                >
                    −
                </StyledButton>
                <StyledButton
                    onClick={() => setZoom((value) => Math.min(1.6, value + 0.1))}
                    disabled={zoom >= 1.6}
                    aria-label="Zoom in graph"
                >
                    +
                </StyledButton>
                <StyledButton onClick={fit}>Fit selection</StyledButton>
                <StyledButton
                    onClick={() => {
                        setExpandedGroups(new Map());
                        setExpandedNodes(new Set());
                    }}
                >
                    Collapse expansions
                </StyledButton>
            </ButtonRow>
            <SmallText role="status">
                {model.representedObjects} objects represented ·{' '}
                {model.nodes.filter((node) => node.memberIds).length} groups ·{' '}
                {model.omittedObjects} omitted by the 60-card budget. Consumers appear to the left;
                dependencies appear to the right. Scroll or use arrow keys in the graph viewport to
                pan.
            </SmallText>
            <Viewport
                ref={viewport}
                role="region"
                aria-label={`Dependency graph centered on ${center.name}`}
                tabIndex={0}
            >
                <Artboard $width={model.width} $height={model.height} $zoom={zoom}>
                    <svg
                        width={model.width * zoom}
                        height={model.height * zoom}
                        viewBox={`0 0 ${model.width} ${model.height}`}
                        aria-hidden="true"
                    >
                        <defs>
                            <marker
                                id={arrow}
                                markerWidth="9"
                                markerHeight="9"
                                refX="9"
                                refY="4.5"
                                orient="auto"
                            >
                                <path d="M0,0 L9,4.5 L0,9 Z" />
                            </marker>
                        </defs>
                        {model.nodes
                            .filter(
                                (node, i, all) =>
                                    all.findIndex((other) => other.level === node.level) === i,
                            )
                            .map((node) => (
                                <text key={node.level} x={node.x} y={30}>
                                    {columnTitle(node.level)}
                                </text>
                            ))}
                        {model.links.map((link) => {
                            const source = nodeById.get(link.source)!;
                            const target = nodeById.get(link.target)!;
                            const forward = target.x >= source.x;
                            const midpointX =
                                (source.x +
                                    (forward ? GRAPH_NODE_WIDTH : 0) +
                                    target.x +
                                    (forward ? 0 : GRAPH_NODE_WIDTH)) /
                                2;
                            const labelX =
                                source.id === target.id
                                    ? source.x + GRAPH_NODE_WIDTH + 40
                                    : midpointX;
                            return (
                                <g key={link.id}>
                                    <path
                                        className={
                                            link.confidence === 'unknown' ||
                                            link.confidence === 'low'
                                                ? 'uncertain'
                                                : ''
                                        }
                                        d={graphLinkPath(source, target)}
                                        markerEnd={`url(#${arrow})`}
                                    >
                                        <title>{`${link.label}: ${link.evidence}`}</title>
                                    </path>
                                    <text
                                        className="edge-label"
                                        x={labelX}
                                        y={
                                            source.id === target.id
                                                ? source.y - 12
                                                : (source.y + target.y) / 2 +
                                                  GRAPH_NODE_HEIGHT / 2 -
                                                  8
                                        }
                                        textAnchor="middle"
                                    >
                                        {link.label.length > 24
                                            ? `${link.label.slice(0, 21)}…`
                                            : link.label}
                                        <title>{link.label}</title>
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                    {model.nodes.map((node) => (
                        <Node
                            key={node.id}
                            $selected={node.id === inspectedId}
                            $x={node.x}
                            $y={node.y}
                            $zoom={zoom}
                            data-graph-node={node.id}
                        >
                            <NodeSelect
                                aria-label={
                                    node.groupKey
                                        ? `${node.name}: ${node.memberIds?.length} grouped objects`
                                        : `Inspect ${node.name}`
                                }
                                title={`${node.name} — ${node.objectType} — ${node.app}`}
                                onClick={() =>
                                    node.groupKey
                                        ? setExpandedGroups((current) =>
                                              new Map(current).set(
                                                  node.groupKey!,
                                                  (current.get(node.groupKey!) ?? 0) + 12,
                                              ),
                                          )
                                        : onInspect(node.id)
                                }
                            >
                                <span className="node-label">
                                    <span className="name">{node.name}</span>
                                    <small className="type">{node.objectType}</small>
                                </span>
                            </NodeSelect>
                            {node.groupKey ? (
                                <StyledButton
                                    onClick={() =>
                                        setExpandedGroups((current) =>
                                            new Map(current).set(
                                                node.groupKey!,
                                                (current.get(node.groupKey!) ?? 0) + 12,
                                            ),
                                        )
                                    }
                                >
                                    Show up to 12 more
                                </StyledButton>
                            ) : (
                                <ButtonRow>
                                    <StatusBadge status={node.status} />
                                    {node.level !== 0 && node.resolved ? (
                                        <StyledButton
                                            disabled={Math.abs(node.level) >= 3}
                                            onClick={() =>
                                                setExpandedNodes((current) => {
                                                    const updated = new Set(current);
                                                    if (updated.has(node.id)) {
                                                        updated.delete(node.id);
                                                    } else {
                                                        updated.add(node.id);
                                                    }
                                                    return updated;
                                                })
                                            }
                                        >
                                            {expandedNodes.has(node.id) ? 'Collapse' : 'Expand'}
                                        </StyledButton>
                                    ) : null}
                                </ButtonRow>
                            )}
                        </Node>
                    ))}
                </Artboard>
            </Viewport>
        </>
    );
}
