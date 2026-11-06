/**
 * WORKBENCH preview-only arithmetic entry, NOT a persistent parametric binding.
 * v1 deliberately accepts only numbers, mm/cm/in and arithmetic. No variables,
 * functions, dynamic code or implicit multiplication; results are binary64 mm.
 * It must never be presented as an exact geometric solver or expression journal.
 */
export const DIMENSION_EXPRESSION_VERSION = 'intuit3d.web-preview.dimension-expression/v1' as const;

interface Quantity { readonly value: number; readonly exponent: number }
type Token = { readonly kind: 'number'; readonly quantity: Quantity } | { readonly kind: 'symbol'; readonly symbol: string };

function checked(value: number, exponent: number): Quantity {
  if (!Number.isFinite(value) || Math.abs(value) > 1e9 || !Number.isInteger(exponent) || Math.abs(exponent) > 4) {
    throw new Error('Dimension expression exceeds preview numerical limits');
  }
  return { value, exponent };
}

function tokenize(source: string): Token[] {
  if (source.length === 0 || source.length > 256) throw new Error('Dimension expression must contain 1–256 characters');
  const tokens: Token[] = [];
  let position = 0;
  while (position < source.length) {
    if (/\s/.test(source.charAt(position))) { position++; continue; }
    if (tokens.length >= 64) throw new Error('Dimension expression exceeds 64 tokens');
    const tail = source.slice(position);
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(tail)?.[0];
    if (number) {
      let value = Number(number);
      if (!Number.isFinite(value) || (value === 0 && /[1-9]/.test(number.replace(/e[+-]?\d+$/i, '')))) {
        throw new Error('Unrepresentable numeric literal');
      }
      position += number.length;
      while (position < source.length && /\s/.test(source.charAt(position))) position++;
      const remaining = source.slice(position);
      const unit = /^(mm|cm|in)(?![a-z])/i.exec(remaining)?.[1]?.toLowerCase();
      if (unit) {
        value *= unit === 'in' ? 25.4 : unit === 'cm' ? 10 : 1;
        position += unit.length;
      }
      tokens.push({ kind: 'number', quantity: checked(value, unit ? 1 : 0) });
      continue;
    }
    const char = source.charAt(position);
    if ('+-*/()'.includes(char)) {
      tokens.push({ kind: 'symbol', symbol: char });
      position++;
      continue;
    }
    throw new Error('Unsupported dimension expression token at character ' + (position + 1));
  }
  if (tokens.length === 0) throw new Error('Dimension expression is empty');
  return tokens;
}

/**
 * Dimensionally checked arithmetic. Bare scalar results and bare operands
 * added to lengths are interpreted as millimetres, matching the inspector.
 * This is a convenient scalar calculator; it does not preserve expressions.
 */
export function evaluateDimensionExpression(source: string): number {
  const tokens = tokenize(source.trim());
  let index = 0;
  const match = (symbol: string): boolean => {
    const next = tokens[index];
    if (next?.kind === 'symbol' && next.symbol === symbol) { index++; return true; }
    return false;
  };
  const primary = (depth: number): Quantity => {
    if (depth > 12) throw new Error('Dimension expression nesting limit exceeded');
    if (match('+')) return primary(depth + 1);
    if (match('-')) {
      const q = primary(depth + 1);
      return checked(-q.value, q.exponent);
    }
    if (match('(')) {
      const q = addition(depth + 1);
      if (!match(')')) throw new Error('Missing closing parenthesis');
      return q;
    }
    const t = tokens[index++];
    if (!t || t.kind !== 'number') throw new Error('Expected numeric dimension operand');
    return t.quantity;
  };
  const multiplication = (depth: number): Quantity => {
    let lhs = primary(depth);
    while (true) {
      if (match('*')) {
        const rhs = primary(depth);
        const result = lhs.value * rhs.value;
        if (lhs.value !== 0 && rhs.value !== 0 && result === 0) throw new Error('Dimension multiplication underflow');
        lhs = checked(result, lhs.exponent + rhs.exponent);
      } else if (match('/')) {
        const rhs = primary(depth);
        if (rhs.value === 0) throw new Error('Division by zero in dimension expression');
        const result = lhs.value / rhs.value;
        if (lhs.value !== 0 && result === 0) throw new Error('Dimension division underflow');
        lhs = checked(result, lhs.exponent - rhs.exponent);
      } else break;
    }
    return lhs;
  };
  const addition = (depth: number): Quantity => {
    let lhs = multiplication(depth);
    while (true) {
      const sign = match('+') ? 1 : match('-') ? -1 : 0;
      if (!sign) break;
      const rhs = multiplication(depth);
      if (lhs.exponent !== rhs.exponent && !([lhs.exponent, rhs.exponent].every(x => x === 0 || x === 1))) {
        throw new Error('Incompatible units in dimension expression');
      }
      lhs = checked(lhs.value + sign * rhs.value, Math.max(lhs.exponent, rhs.exponent));
    }
    return lhs;
  };
  const result = addition(0);
  if (index !== tokens.length) throw new Error('Unexpected trailing dimension expression tokens');
  if (result.exponent !== 0 && result.exponent !== 1) {
    throw new Error('Dimension expression must evaluate to a length, not area or inverse length');
  }
  return checked(result.value, result.exponent).value;
}
