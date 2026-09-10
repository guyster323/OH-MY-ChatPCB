const HOST_ITEM_KINDS = new Set(['symbol', 'label', 'global_label', 'hierarchical_label']);
const LABEL_ITEM_KINDS = new Set(['label', 'global_label', 'hierarchical_label']);
const LABEL_FACT_CATEGORIES = new Set(['schematic.label', 'schematic.global_label', 'schematic.hierarchical_label']);
const HOST_STATES = new Set(['embedded', 'standalone', 'mock']);
const CONNECTIVITY_DIAGNOSTIC = {
  code: 'SELECTION_CONNECTIVITY_UNPROVEN',
  message: 'Pin-to-net connectivity is not proven by the current saved-artifact analyzer.'
};

const clone = (value) => value === undefined ? undefined : structuredClone(value);

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareDiagnostics(left, right) {
  return compareText(left.code ?? '', right.code ?? '') || compareText(left.message ?? '', right.message ?? '');
}

function compareItems(left, right) {
  return compareText(left.kind, right.kind)
    || compareText(left.kiid ?? '', right.kiid ?? '')
    || compareText(left.reference ?? '', right.reference ?? '')
    || compareText(left.text ?? '', right.text ?? '')
    || left.position.x - right.position.x
    || left.position.y - right.position.y;
}

function normalizePosition(position) {
  if (!position || typeof position !== 'object' || Array.isArray(position)) return null;
  const { x, y } = position;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function itemKey(item) {
  if (item.kind === 'symbol') {
    return item.kiid ? `symbol:${item.kiid}` : `symbol:${item.reference}:${item.position.x}:${item.position.y}`;
  }
  return item.kiid ? `${item.kind}:${item.kiid}` : `${item.kind}:${item.text}:${item.position.x}:${item.position.y}`;
}

function normalizeEditor(selection) {
  const raw = selection.editor && typeof selection.editor === 'object' && !Array.isArray(selection.editor)
    ? selection.editor.kind
    : selection.editor;
  const editor = trimString(raw);
  if (!editor || editor === 'schematic') return { editor: 'schematic' };
  return {
    editor: 'schematic',
    diagnostic: { code: 'SELECTION_ITEM_INVALID', message: 'Selection editor is not a supported schematic context' }
  };
}

function normalizeHostState(value) {
  const hostState = trimString(value);
  if (!hostState) return { hostState: 'standalone' };
  if (HOST_STATES.has(hostState)) return { hostState };
  return {
    hostState: 'standalone',
    diagnostic: { code: 'SELECTION_ITEM_INVALID', message: 'Selection hostState is not recognized' }
  };
}

function emptyNormalized(diagnostics = []) {
  return {
    editor: 'schematic',
    sheet: undefined,
    dirty: false,
    hostState: 'standalone',
    items: [],
    diagnostics: diagnostics.slice().sort(compareDiagnostics)
  };
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { unsupported: true };
  const kind = trimString(item.kind);
  if (!HOST_ITEM_KINDS.has(kind)) return { unsupported: true };
  const position = normalizePosition(item.position);
  if (!position) return { invalid: true };
  const kiid = trimString(item.kiid);
  if (kind === 'symbol') {
    const reference = trimString(item.reference);
    if (!kiid && !reference) return { invalid: true };
    return {
      item: {
        kind,
        ...(kiid ? { kiid } : {}),
        ...(reference ? { reference } : {}),
        position
      }
    };
  }
  const text = trimString(item.text);
  if (!text) return { invalid: true };
  return {
    item: {
      kind,
      ...(kiid ? { kiid } : {}),
      text,
      position
    }
  };
}

export function normalizeSelectionContext(selection) {
  if (selection == null || typeof selection !== 'object' || Array.isArray(selection)) {
    return emptyNormalized([{ code: 'SELECTION_ITEM_INVALID', message: 'Selection context is not an object' }]);
  }

  const diagnostics = [];
  const editorResult = normalizeEditor(selection);
  if (editorResult.diagnostic) diagnostics.push(editorResult.diagnostic);
  const hostResult = normalizeHostState(selection.hostState);
  if (hostResult.diagnostic) diagnostics.push(hostResult.diagnostic);
  const sheet = trimString(selection.sheet) || undefined;

  if (selection.items !== undefined && !Array.isArray(selection.items)) {
    diagnostics.push({ code: 'SELECTION_ITEM_INVALID', message: 'Selection items must be an array' });
    return {
      editor: editorResult.editor,
      sheet,
      dirty: selection.dirty === true,
      hostState: hostResult.hostState,
      items: [],
      diagnostics: diagnostics.sort(compareDiagnostics)
    };
  }

  let unsupported = false;
  let invalid = false;
  const normalizedItems = [];
  for (const rawItem of selection.items ?? []) {
    const result = normalizeItem(rawItem);
    if (result.unsupported) {
      unsupported = true;
      continue;
    }
    if (result.invalid) {
      invalid = true;
      continue;
    }
    normalizedItems.push(result.item);
  }
  if (unsupported) {
    diagnostics.push({
      code: 'KICAD_SELECTION_UNSUPPORTED',
      message: normalizedItems.length === 0
        ? 'No supported selection anchors were captured.'
        : 'Unsupported selection items were omitted.'
    });
  }
  if (invalid) {
    diagnostics.push({
      code: 'SELECTION_ITEM_INVALID',
      message: 'Selection items with invalid identity or coordinates were omitted.'
    });
  }

  normalizedItems.sort(compareItems);
  const items = [];
  const seen = new Set();
  for (const item of normalizedItems) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  return {
    editor: editorResult.editor,
    sheet,
    dirty: selection.dirty === true,
    hostState: hostResult.hostState,
    items,
    diagnostics: diagnostics.sort(compareDiagnostics)
  };
}

function factMatchesItem(fact, item) {
  if (!fact || typeof fact !== 'object') return false;
  if (item.kind === 'symbol') {
    if (fact.category !== 'schematic.component') return false;
    if (item.kiid) return fact.value?.uuid === item.kiid;
    if (item.reference && fact.value?.reference === item.reference) {
      const factPosition = fact.value?.position;
      if (factPosition && item.position) {
        return factPosition.x === item.position.x && factPosition.y === item.position.y;
      }
      return true;
    }
    return false;
  }
  if (!LABEL_ITEM_KINDS.has(item.kind)) return false;
  if (LABEL_FACT_CATEGORIES.has(fact.category) && fact.value?.text === item.text) return true;
  return fact.category === 'schematic.net' && fact.value?.name === item.text;
}

function unmatchedDiagnostic(item) {
  const identity = item.kind === 'symbol' ? (item.reference || item.kiid) : item.text;
  return {
    code: 'SELECTION_FACT_UNMATCHED',
    message: `No saved-artifact fact matched selected ${item.kind} ${identity}`
  };
}

export function buildSelectionEvidence({ selection, inspection } = {}) {
  const normalized = normalizeSelectionContext(selection);
  const sourceFacts = Array.isArray(inspection?.facts) ? inspection.facts : [];
  const sourceFindings = Array.isArray(inspection?.findings) ? inspection.findings : [];
  const retained = [];
  const retainedIds = new Set();
  const diagnostics = [...normalized.diagnostics];

  for (const item of normalized.items) {
    const matches = sourceFacts.filter((fact) => factMatchesItem(fact, item));
    if (matches.length === 0) diagnostics.push(unmatchedDiagnostic(item));
    for (const fact of matches) {
      if (retainedIds.has(fact.id)) continue;
      retainedIds.add(fact.id);
      retained.push(clone(fact));
    }
  }

  retained.sort((left, right) => compareText(left.id, right.id));
  const findings = sourceFindings
    .filter((finding) => Array.isArray(finding?.factIds) && finding.factIds.every((factId) => retainedIds.has(factId)))
    .map((finding) => clone(finding))
    .sort((left, right) => compareText(left.id ?? '', right.id ?? ''));

  const result = {
    schemaVersion: 1,
    editor: {
      kind: normalized.editor,
      sheet: normalized.sheet,
      dirty: normalized.dirty,
      hostState: normalized.hostState
    },
    selection: {
      mode: normalized.items.length > 0 ? 'explicit' : 'project',
      items: clone(normalized.items)
    },
    facts: retained,
    findings,
    coverage: {
      status: 'partial',
      diagnostics: [clone(CONNECTIVITY_DIAGNOSTIC)]
    },
    diagnostics: diagnostics.sort(compareDiagnostics)
  };
  if (inspection?.project !== undefined) result.project = clone(inspection.project);
  if (inspection?.verification !== undefined) result.verification = clone(inspection.verification);
  return result;
}
