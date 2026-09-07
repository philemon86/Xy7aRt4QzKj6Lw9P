'use client';
import { useState } from 'react';
import { Calculator as CalculatorIcon, Delete, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { evaluateExpression, insertOperand } from '@/lib/pos-core.mjs';

export default function Calculator({
  cash,
  refreshCash,
}: {
  cash: number;
  refreshCash: () => Promise<number>;
}) {
  const [expression, setExpression] = useState('');
  const [answer, setAnswer] = useState<string>('0');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [lastExpression, setLastExpression] = useState('');
  const money = (value: number) =>
    value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
  function calculate() {
    try {
      const value = String(evaluateExpression(expression));
      setLastExpression(expression);
      setAnswer(value);
      setExpression(value);
      setFinished(true);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }
  function key(value: string) {
    setError('');
    if (value === '=') return calculate();
    if (value === 'C') {
      setExpression('');
      setAnswer('0');
      setLastExpression('');
      setFinished(false);
      return;
    }
    if (value === '⌫') {
      setExpression((v) => v.slice(0, -1));
      setFinished(false);
      return;
    }
    setExpression((v) => (finished && /[\d.(]/.test(value) ? '' : v) + value);
    setFinished(false);
  }
  return (
    <section className="calculator-layout">
      <div className="calculator-context">
        <span className="eyebrow">QUICK CALCULATOR</span>
        <h2>
          <CalculatorIcon /> 隨手算一下
        </h2>
        <p>盤點、找零、加總，用熟悉的加減乘除。</p>
        <div className="cash-reference">
          <Wallet size={22} />
          <span>
            本場目前現金淨額<strong>NT$ {money(cash)}</strong>
            <small>有效交易的現金收入與退款，含混合付款。</small>
          </span>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            try {
              const latest = await refreshCash();
              setExpression((v) => insertOperand(finished ? '' : v, latest));
              setFinished(false);
              setError('');
            } catch (e: any) {
              setError(e.message);
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? '讀取中…' : '帶入目前現金'}
        </Button>
        <p className="muted">
          先按「帶入目前現金」，再輸入運算符號與金額。計算結果只供參考。
        </p>
      </div>
      <div className="calculator">
        <label htmlFor="calculator-expression">算式</label>
        <Input
          id="calculator-expression"
          value={expression}
          placeholder="0"
          autoComplete="off"
          onChange={(e) => {
            setExpression(e.target.value);
            setFinished(false);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              calculate();
            }
          }}
        />
        <div className="calculator-answer" aria-live="polite">
          <small>
            {lastExpression ? lastExpression + ' =' : '支援鍵盤與觸控'}
          </small>
          <output>{answer}</output>
        </div>
        <p className="calculator-error" role="status">
          {error || '\u00a0'}
        </p>
        <div className="calculator-keys">
          {[
            'C',
            '(',
            ')',
            '⌫',
            '7',
            '8',
            '9',
            '÷',
            '4',
            '5',
            '6',
            '×',
            '1',
            '2',
            '3',
            '−',
            '0',
            '.',
            '=',
            '+',
          ].map((value) => (
            <Button
              key={value}
              variant="ghost"
              className={
                value === '='
                  ? 'primary'
                  : /[÷×−+]/.test(value)
                    ? 'operator'
                    : ''
              }
              aria-label={
                value === '⌫'
                  ? '刪除最後一字'
                  : value === 'C'
                    ? '全部清除'
                    : value
              }
              onClick={() => key(value)}
            >
              {value === '⌫' ? <Delete /> : value}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}
