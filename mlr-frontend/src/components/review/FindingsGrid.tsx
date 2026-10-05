import { useMemo } from 'react';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellFocusedEvent,
  type CellKeyDownEvent,
  type ColDef,
  type RowClickedEvent,
  type SelectionChangedEvent,
  type SuppressKeyboardEventParams,
} from 'ag-grid-community';
import type { FindingView } from '@pre-mlr/shared';
import {
  CATEGORY_LABEL,
  displayFix,
  pageLabel,
  severityRank,
  type GridRow,
} from '../../review/model';
import { SeverityBadge, SourceTag, StatusBadge } from './Badges';

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: 'inherit',
  fontSize: 13,
  headerFontWeight: 600,
  accentColor: '#0969da',
  rowHoverColor: '#f6f8fa',
  selectedRowBackgroundColor: '#ddf4ff',
});

export type FindingAction = 'accept' | 'reject' | 'reopen' | 'edit' | 'comment';

export interface GridContext {
  onAction: (action: FindingAction, finding: FindingView) => void;
  onToggleGroup: (key: string) => void;
}

interface Props {
  rows: GridRow[];
  grouped: boolean;
  context: GridContext;
  onFocusFinding: (id: string) => void;
  onSelectionChange: (ids: string[]) => void;
}

/** jsdom has no layout or animation frames, so tests render every row synchronously. */
const RENDER_ALL = import.meta.env.MODE === 'test';
/** Auto-height cells wait for ResizeObserver measurements, which never arrive in jsdom. */
const AUTO_HEIGHT = !RENDER_ALL;

const finding = (row: GridRow | undefined) => (row?.kind === 'finding' ? row.finding : undefined);

export function FindingsGrid({ rows, grouped, context, onFocusFinding, onSelectionChange }: Props) {
  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        headerName: 'Page',
        colId: 'page',
        valueGetter: (p) => (finding(p.data) ? pageLabel(finding(p.data)!) : ''),
        width: 120,
        wrapText: true,
        autoHeight: AUTO_HEIGHT,
        comparator: (_a, _b, na, nb) =>
          (finding(na.data)?.page?.number ?? 0) - (finding(nb.data)?.page?.number ?? 0),
      },
      {
        headerName: 'Rule',
        colId: 'rule',
        valueGetter: (p) => finding(p.data)?.rule.title,
        cellRenderer: (p: CustomCellRendererProps<GridRow>) => {
          const f = finding(p.data);
          return f ? (
            <span>
              {f.rule.title} <SourceTag detectedBy={f.detectedBy} confidence={f.confidence} />
              <span className="rule-version muted">
                {f.ruleId} v{f.ruleVersion}
              </span>
            </span>
          ) : null;
        },
        flex: 1.2,
        minWidth: 150,
        wrapText: true,
        autoHeight: AUTO_HEIGHT,
        tooltipValueGetter: (p) => finding(p.data)?.ruleId,
      },
      {
        headerName: 'Category',
        colId: 'category',
        valueGetter: (p) => (finding(p.data) ? CATEGORY_LABEL[finding(p.data)!.rule.category] : ''),
        width: 110,
        wrapText: true,
        autoHeight: AUTO_HEIGHT,
      },
      {
        headerName: 'Severity',
        colId: 'severity',
        valueGetter: (p) => finding(p.data)?.severity,
        cellRenderer: (p: CustomCellRendererProps<GridRow>) =>
          finding(p.data) ? <SeverityBadge severity={finding(p.data)!.severity} /> : null,
        comparator: (_a, _b, na, nb) =>
          severityRank(finding(na.data)!.severity) - severityRank(finding(nb.data)!.severity),
        width: 100,
      },
      {
        headerName: 'Evidence',
        colId: 'evidence',
        valueGetter: (p) => {
          const f = finding(p.data);
          return f ? (f.evidenceText ? `${f.message} — “${f.evidenceText}”` : f.message) : '';
        },
        flex: 2,
        minWidth: 180,
        wrapText: true,
        autoHeight: AUTO_HEIGHT,
      },
      {
        headerName: 'Suggested fix',
        colId: 'fix',
        valueGetter: (p) => (finding(p.data) ? displayFix(finding(p.data)!) : ''),
        cellRenderer: (p: CustomCellRendererProps<GridRow>) => {
          const f = finding(p.data);
          if (!f) return null;
          return (
            <span>
              {f.editedFix && <span className="tag">Edited</span>} {displayFix(f) ?? '—'}
            </span>
          );
        },
        flex: 2,
        minWidth: 160,
        wrapText: true,
        autoHeight: AUTO_HEIGHT,
      },
      {
        headerName: 'Status',
        colId: 'status',
        valueGetter: (p) => finding(p.data)?.status,
        cellRenderer: (p: CustomCellRendererProps<GridRow>) =>
          finding(p.data) ? <StatusBadge status={finding(p.data)!.status} /> : null,
        width: 95,
      },
      // Pinned so the actions stay visible when the other columns scroll sideways.
      {
        headerName: 'Actions',
        colId: 'actions',
        cellRenderer: ActionsCell,
        width: 200,
        pinned: 'right',
        sortable: false,
        autoHeight: AUTO_HEIGHT,
        suppressKeyboardEvent: keyboardIntoButtons,
      },
    ],
    [],
  );

  return (
    <div className="grid-wrap">
      <AgGridReact<GridRow>
        theme={theme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: !grouped, resizable: true, suppressHeaderMenuButton: true }}
        context={context}
        getRowId={(p) => (p.data.kind === 'group' ? `group:${p.data.key}` : p.data.finding.id)}
        isFullWidthRow={(p) => p.rowNode.data?.kind === 'group'}
        fullWidthCellRenderer={GroupRow}
        rowSelection={{
          mode: 'multiRow',
          checkboxes: true,
          headerCheckbox: true,
          selectAll: 'filtered',
          enableClickSelection: false,
          isRowSelectable: (node) => node.data?.kind === 'finding',
        }}
        onSelectionChanged={(e: SelectionChangedEvent<GridRow>) =>
          onSelectionChange(
            e.api.getSelectedRows().flatMap((r) => (r.kind === 'finding' ? [r.finding.id] : [])),
          )
        }
        onCellFocused={(e: CellFocusedEvent<GridRow>) => {
          const f =
            e.rowIndex == null
              ? undefined
              : finding(e.api.getDisplayedRowAtIndex(e.rowIndex)?.data);
          if (f) onFocusFinding(f.id);
        }}
        onCellKeyDown={(e: CellKeyDownEvent<GridRow>) => {
          // Group header rows: Enter or Space toggles them.
          const key = (e.event as KeyboardEvent | undefined)?.key;
          if (e.data?.kind === 'group' && (key === 'Enter' || key === ' ')) {
            e.event?.preventDefault();
            context.onToggleGroup(e.data.key);
          }
        }}
        onRowClicked={(e: RowClickedEvent<GridRow>) => {
          const f = finding(e.data);
          if (f) onFocusFinding(f.id);
        }}
        suppressRowVirtualisation={RENDER_ALL}
        suppressColumnVirtualisation={RENDER_ALL}
        suppressAnimationFrame={RENDER_ALL}
        ensureDomOrder
        overlayNoRowsTemplate="No findings match the filters."
      />
    </div>
  );
}

/**
 * AG Grid moves Tab between cells, which would skip the buttons inside the Actions cell. Here, Enter
 * or Tab on the cell focuses its first button, Tab/Shift+Tab move between buttons natively, and
 * leaving past the last (or before the first) button hands control back to the grid.
 */
function keyboardIntoButtons({ event }: SuppressKeyboardEventParams<GridRow>): boolean {
  if (event.key !== 'Tab' && event.key !== 'Enter') return false;
  const cell = (event.target as HTMLElement).closest<HTMLElement>('.ag-cell');
  const buttons = cell
    ? [...cell.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
    : [];
  if (!cell || !buttons.length) return false;
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);

  if (event.key === 'Enter') {
    if (i !== -1) return true; // activate the focused button natively
    if (event.type === 'keydown') {
      event.preventDefault();
      buttons[0]!.focus();
    }
    return true;
  }
  if (event.shiftKey) {
    if (i > 0) return true; // previous button
    if (i === 0 && event.type === 'keydown') {
      event.preventDefault();
      cell.focus();
    }
    return i === 0;
  }
  if (i === -1) {
    if (event.type === 'keydown') {
      event.preventDefault();
      buttons[0]!.focus();
    }
    return true;
  }
  return i < buttons.length - 1; // next button; from the last one, let the grid move on
}

function ActionsCell(p: CustomCellRendererProps<GridRow, unknown, GridContext>) {
  const f = finding(p.data);
  if (!f) return null;
  const { onAction } = p.context;
  const what = `${f.rule.title} on ${pageLabel(f)}`;
  return (
    <div className="row-actions">
      {f.status === 'open' ? (
        <>
          <button
            type="button"
            className="btn small accept"
            aria-label={`Accept: ${what}`}
            onClick={() => onAction('accept', f)}
          >
            Accept
          </button>
          <button
            type="button"
            className="btn small reject"
            aria-label={`Reject: ${what}`}
            onClick={() => onAction('reject', f)}
          >
            Reject
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn small"
          aria-label={`Reopen: ${what}`}
          onClick={() => onAction('reopen', f)}
        >
          Reopen
        </button>
      )}
      <button
        type="button"
        className="btn small"
        aria-label={`Edit fix: ${what}`}
        onClick={() => onAction('edit', f)}
      >
        Edit
      </button>
      <button
        type="button"
        className="btn small"
        aria-label={`Comment: ${what}`}
        onClick={() => onAction('comment', f)}
      >
        Comment
      </button>
    </div>
  );
}

function GroupRow(p: CustomCellRendererProps<GridRow, unknown, GridContext>) {
  const row = p.data;
  if (row?.kind !== 'group') return null;
  return (
    <div className="group-row">
      <button
        type="button"
        className="group-toggle"
        aria-expanded={!row.collapsed}
        onClick={() => p.context.onToggleGroup(row.key)}
      >
        <span aria-hidden="true">{row.collapsed ? '▸' : '▾'}</span> {row.label}
      </button>
      <span className="muted">
        {row.count} finding{row.count === 1 ? '' : 's'}, {row.open} open
      </span>
    </div>
  );
}
