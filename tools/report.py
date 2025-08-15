from __future__ import annotations

import pandas as _pd  # alias to avoid shadowing if user imports pandas as pd elsewhere


def make_group_key(df: _pd.DataFrame, by: list[str]) -> _pd.Series:
    """Vectorized group-key (tuple-valued Series)."""
    if not by:
        return _pd.Series([0] * len(df), index=df.index, dtype=object)
    # Pandas groupby happily accepts a tuple-valued Series as the 'by' key;
    # we materialize it once for re-use across multiple metrics.
    mi = _pd.MultiIndex.from_frame(df[by], names=by)
    return _pd.Series(mi.to_list(), index=df.index, dtype=object)


from dataclasses import dataclass, field as dc_field
from enum import StrEnum
from typing import Any, Iterable, Sequence, Mapping, override
import pandas as pd
import numpy as np
import re
import json

# ========= 0) 类型别名（PEP 695） =========

type RowAgg = "sum" | "mean" | "min" | "max" | "count" | "nunique"


# ========= 1) 工具 =========
def _flatten_multi_columns(cols: Iterable[tuple[str, ...]]) -> list[str]:
    out: list[str] = []
    for t in cols:
        parts = [str(x) for x in t if x is not None and str(x) != ""]
        out.append(" / ".join(parts) if parts else "")
    return out


def Concat(a: "ScalarExpr | str", b: "ScalarExpr | str") -> "ScalarExpr":
    sa = _resolve_scalar(a)
    sb = _resolve_scalar(b)
    return BinaryOp(sa, sb, _op_fn("||"), "||")


def _op_fn(symbol: str):
    if symbol == "+":  return lambda a, b: a + b
    if symbol == "-":  return lambda a, b: a - b
    if symbol == "*":  return lambda a, b: a * b
    if symbol == "/":  return lambda a, b: a / b
    if symbol == "||": return lambda a, b: a.astype(str) + b.astype(str)
    raise ValueError(f"Unsupported binary op: {symbol}")


# ========= 2) 方言 =========
class Dialect(StrEnum):
    ANSI = "ansi"
    DUCKDB = "duckdb"
    BIGQUERY = "bigquery"


# ========= 3) 表达式体系 =========
class Expr[T]:
    def dependencies(self) -> set[str]:
        return set()


class ScalarExpr[T](Expr[T]):
    def eval(self, df: pd.DataFrame) -> pd.Series:
        raise NotImplementedError

    # 算术
    def __add__(self, other: "ScalarExpr | str | int | float") -> "ScalarExpr":
        return BinaryOp(self, _resolve_scalar(other), _op_fn("+"), "+")

    def __radd__(self, other): return _resolve_scalar(other).__add__(self)

    def __sub__(self, other):  return BinaryOp(self, _resolve_scalar(other), _op_fn("-"), "-")

    def __rsub__(self, other): return _resolve_scalar(other).__sub__(self)

    def __mul__(self, other):  return BinaryOp(self, _resolve_scalar(other), _op_fn("*"), "*")

    def __rmul__(self, other): return _resolve_scalar(other).__mul__(self)

    def __truediv__(self, other):  return SafeDiv(self, _resolve_scalar(other))

    def __rtruediv__(self, other): return SafeDiv(_resolve_scalar(other), self)

    # 比较 -> 谓词（Python 原生 + 显式方法）
    def __eq__(self, other) -> "PredicateExpr":  return Cmp(self, _resolve_scalar(other), "==")  # noqa: E741

    def __ne__(self, other) -> "PredicateExpr":  return Cmp(self, _resolve_scalar(other), "!=")

    def __gt__(self, other) -> "PredicateExpr":  return Cmp(self, _resolve_scalar(other), ">")

    def __ge__(self, other) -> "PredicateExpr":  return Cmp(self, _resolve_scalar(other), ">=")

    def __lt__(self, other) -> "PredicateExpr":  return Cmp(self, _resolve_scalar(other), "<")

    def __le__(self, other) -> "PredicateExpr":  return Cmp(self, _resolve_scalar(other), "<=")

    def eq(self, other) -> "PredicateExpr": return self.__eq__(other)

    def ne(self, other) -> "PredicateExpr": return self.__ne__(other)

    def gt(self, other) -> "PredicateExpr": return self.__gt__(other)

    def ge(self, other) -> "PredicateExpr": return self.__ge__(other)

    def lt(self, other) -> "PredicateExpr": return self.__lt__(other)

    def le(self, other) -> "PredicateExpr": return self.__le__(other)

    # 集合/区间/空值
    def isin(self, values: Sequence[Any]) -> "PredicateExpr": return InSet(self, list(values))

    def between(self, left: Any, right: Any, inclusive: str = "both") -> "PredicateExpr":
        return Between(self, left, right, inclusive)

    def isnull(self) -> "PredicateExpr": return IsNull(self)

    def notnull(self) -> "PredicateExpr": return ~IsNull(self)

    # 字符串谓词
    def like(self, pattern: "ScalarExpr | str") -> "PredicateExpr":
        return LikePredicate(self, _resolve_scalar(pattern), case_insensitive=False, neg=False)

    def not_like(self, pattern: "ScalarExpr | str") -> "PredicateExpr":
        return LikePredicate(self, _resolve_scalar(pattern), case_insensitive=False, neg=True)

    def ilike(self, pattern: "ScalarExpr | str") -> "PredicateExpr":
        return LikePredicate(self, _resolve_scalar(pattern), case_insensitive=True, neg=False)

    def not_ilike(self, pattern: "ScalarExpr | str") -> "PredicateExpr":
        return LikePredicate(self, _resolve_scalar(pattern), case_insensitive=True, neg=True)

    def contains(self, sub: "ScalarExpr | str", *, case_insensitive: bool = False) -> "PredicateExpr":
        pat = _resolve_scalar(sub)
        if isinstance(pat, Literal) and isinstance(pat.value, str):
            return LikePredicate(self, Literal(f"%{pat.value}%"), case_insensitive, neg=False)
        return LikePredicate(self, Concat(Concat(Literal("%"), pat), Literal("%")),
                             case_insensitive, neg=False)

    def regex(self, pattern: "ScalarExpr | str", *, flags: str | None = None, neg: bool = False) -> "PredicateExpr":
        return RegexPredicate(self, _resolve_scalar(pattern), flags or "", neg)


class AggExpr[T](Expr[T]):
    def aggregate(self, df: pd.DataFrame, by: list[str]) -> pd.Series:
        raise NotImplementedError


class WindowExpr[T](Expr[T]):
    ...


class PredicateExpr(ScalarExpr[bool]):
    def __and__(self, other: "PredicateExpr") -> "PredicateExpr": return BoolOp(self, other, "and")

    def __or__(self, other: "PredicateExpr") -> "PredicateExpr":  return BoolOp(self, other, "or")

    def __invert__(self) -> "PredicateExpr": return NotOp(self)


# ---- 具体 ScalarExpr ----
class ColumnRef(ScalarExpr[Any]):
    def __init__(self, name: str): self.name = name

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series: return df[self.name]

    @override
    def dependencies(self) -> set[str]: return {self.name}

    def __str__(self) -> str: return self.name


class Literal(ScalarExpr[Any]):
    def __init__(self, value: Any): self.value = value

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series:
        return pd.Series([self.value] * len(df), index=df.index)

    def __str__(self) -> str: return repr(self.value)


class Coalesce(ScalarExpr[Any]):
    def __init__(self, *exprs: ScalarExpr | str):
        self.exprs: list[ScalarExpr] = [_resolve_scalar(e) for e in exprs]

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series:
        s = self.exprs[0].eval(df).copy()
        for e in self.exprs[1:]:
            s = s.fillna(e.eval(df))
        return s

    @override
    def dependencies(self) -> set[str]:
        out: set[str] = set()
        for e in self.exprs: out |= e.dependencies()
        return out


class CaseWhen(ScalarExpr[Any]):
    def __init__(self, whens: list[tuple[PredicateExpr, ScalarExpr | str]],
                 otherwise: ScalarExpr | str | None = None):
        self.whens = [(cond, _resolve_scalar(val)) for cond, val in whens]
        self.otherwise = _resolve_scalar(otherwise) if otherwise is not None else None

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series:
        res = pd.Series(index=df.index, dtype="object")
        covered = pd.Series(False, index=df.index)
        for cond, val in self.whens:
            m = cond.eval(df)
            pick = m & ~covered
            if pick.any():
                res[pick] = val.eval(df)[pick]
                covered |= m
        if self.otherwise is not None:
            res[~covered] = self.otherwise.eval(df)[~covered]
        return res

    @override
    def dependencies(self) -> set[str]:
        out = set()
        for c, v in self.whens: out |= c.dependencies() | v.dependencies()
        if self.otherwise is not None: out |= self.otherwise.dependencies()
        return out


class BinaryOp(ScalarExpr[Any]):
    def __init__(self, left: ScalarExpr, right: ScalarExpr, op, symbol: str):
        self.left, self.right, self.op, self.symbol = left, right, op, symbol

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series: return self.op(self.left.eval(df), self.right.eval(df))

    @override
    def dependencies(self) -> set[str]: return self.left.dependencies() | self.right.dependencies()

    def __str__(self) -> str: return f"({self.left} {self.symbol} {self.right})"


class SafeDiv(ScalarExpr[float]):
    def __init__(self, numerator: ScalarExpr, denominator: ScalarExpr, fill: float = 0.0):
        self.numer, self.denom, self.fill = numerator, denominator, fill

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series:
        n = self.numer.eval(df)
        d = self.denom.eval(df).replace({0: np.nan})
        return (n / d).fillna(self.fill)

    @override
    def dependencies(self) -> set[str]: return self.numer.dependencies() | self.denom.dependencies()


# ---- 谓词 ----
class Cmp(PredicateExpr):
    def __init__(self, left: ScalarExpr, right: ScalarExpr, op: str):
        self.left, self.right, self.op = left, right, op

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series:
        l, r = self.left.eval(df), self.right.eval(df)
        match self.op:
            case "==" | "=":  # 新增 "=" 兼容
                return l == r
            case "!=" | "<>":  # 新增 "<>" 兼容
                return l != r
            case ">":
                return l > r
            case ">=":
                return l >= r
            case "<":
                return l < r
            case "<=":
                return l <= r
            case _:
                raise ValueError(self.op)

    @override
    def dependencies(self) -> set[str]:
        return self.left.dependencies() | self.right.dependencies()


class InSet(PredicateExpr):
    def __init__(self, expr: ScalarExpr, values: list[Any]):
        self.expr, self.values = expr, values

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series: return self.expr.eval(df).isin(self.values)

    @override
    def dependencies(self) -> set[str]: return self.expr.dependencies()


class Between(PredicateExpr):
    def __init__(self, expr: ScalarExpr, left: Any, right: Any, inclusive: str = "both"):
        self.expr, self.left, self.right, self.inclusive = expr, left, right, inclusive

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series:
        return self.expr.eval(df).between(self.left, self.right, inclusive=self.inclusive)

    @override
    def dependencies(self) -> set[str]: return self.expr.dependencies()


class IsNull(PredicateExpr):
    def __init__(self, expr: ScalarExpr): self.expr = expr

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series: return self.expr.eval(df).isna()

    @override
    def dependencies(self) -> set[str]: return self.expr.dependencies()


class BoolOp(PredicateExpr):
    def __init__(self, left: PredicateExpr, right: PredicateExpr, op: str):
        self.left, self.right, self.op = left, right, op

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series:
        match self.op:
            case "and":
                return self.left.eval(df) & self.right.eval(df)
            case "or":
                return self.left.eval(df) | self.right.eval(df)
            case _:
                raise ValueError(self.op)

    @override
    def dependencies(self) -> set[str]:
        return self.left.dependencies() | self.right.dependencies()


class NotOp(PredicateExpr):
    def __init__(self, inner: PredicateExpr): self.inner = inner

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series: return ~self.inner.eval(df)

    @override
    def dependencies(self) -> set[str]: return self.inner.dependencies()


def _like_to_regex(pat: str) -> str:
    buf = []
    for ch in pat:
        if ch == "%":
            buf.append(".*")
        elif ch == "_":
            buf.append(".")
        else:
            buf.append(re.escape(ch))
    return "^" + "".join(buf) + "$"


class LikePredicate(PredicateExpr):
    def __init__(self, expr: ScalarExpr, pattern: ScalarExpr, case_insensitive: bool, neg: bool):
        self.expr, self.pattern = expr, pattern
        self.ci, self.neg = case_insensitive, neg

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series:
        s = self.expr.eval(df).astype(str)
        p = self.pattern
        if isinstance(p, Literal) and isinstance(p.value, str):
            regex = _like_to_regex(p.value)
            m = s.str.contains(regex, regex=True, case=not self.ci, na=False)
        else:
            patt = p.eval(df).astype(str)
            mask = []
            for val, pat in zip(s, patt):
                regex = re.compile(_like_to_regex(pat), 0 if not self.ci else re.IGNORECASE)
                mask.append(bool(regex.search(val)))
            m = pd.Series(mask, index=df.index)
        return ~m if self.neg else m

    @override
    def dependencies(self) -> set[str]:
        return self.expr.dependencies() | self.pattern.dependencies()


class RegexPredicate(PredicateExpr):
    def __init__(self, expr: ScalarExpr, pattern: ScalarExpr, flags: str, neg: bool = False):
        self.expr, self.pattern, self.flags, self.neg = expr, pattern, flags, neg

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series:
        s = self.expr.eval(df).astype(str)
        if isinstance(self.pattern, Literal) and isinstance(self.pattern.value, str):
            flags = 0
            if "i" in self.flags.lower(): flags |= re.IGNORECASE
            m = s.str.contains(self.pattern.value, regex=True, na=False, flags=flags)
        else:
            patt = self.pattern.eval(df).astype(str)
            mask = []
            for val, pat in zip(s, patt):
                rgx = re.compile(pat, re.IGNORECASE if "i" in self.flags.lower() else 0)
                mask.append(bool(rgx.search(val)))
            m = pd.Series(mask, index=df.index)
        return ~m if self.neg else m

    @override
    def dependencies(self) -> set[str]:
        return self.expr.dependencies() | self.pattern.dependencies()


def col(name: str) -> ColumnRef: return ColumnRef(name)


def lit(value: Any) -> Literal:  return Literal(value)


def _resolve_scalar(x: ScalarExpr | str | int | float | None) -> ScalarExpr:
    if isinstance(x, ScalarExpr): return x
    if isinstance(x, str): return col(x)
    return lit(x)


# ========= 4) 字段/度量 =========
class FieldRole(StrEnum):
    ROW = "row"
    COLUMN = "column"


class Field[T]:
    def __init__(self, name: str, role: FieldRole = FieldRole.COLUMN):
        self.name, self.role = name, role

    def __repr__(self) -> str: return f"<Field name={self.name} role={self.role}>"


class Dimension(Field[Any]):
    def __init__(self, name: str, role: FieldRole = FieldRole.ROW,
                 levels: list[str] | None = None, time_grain: str | None = None):
        super().__init__(name, role)
        self.levels = levels or []
        self.time_grain = time_grain

    def materialize(self, df: pd.DataFrame) -> tuple[str, pd.Series]:
        if not self.time_grain:
            return self.name, df[self.name]
        s = pd.to_datetime(df[self.name], errors="coerce")
        g = self.time_grain.lower()
        match g:
            case "month" | "m":
                mat = s.dt.to_period("M").dt.to_timestamp()
            case "day" | "d":
                mat = s.dt.to_period("D").dt.to_timestamp()
            case "week" | "w":
                mat = s.dt.to_period("W").dt.start_time
            case "quarter" | "q":
                mat = s.dt.to_period("Q").dt.start_time
            case "year" | "y":
                mat = s.dt.to_period("Y").dt.start_time
            case _:
                raise ValueError(f"Unsupported time_grain: {self.time_grain}")
        out_name = f"__{self.name}@{g}__"
        return out_name, mat

    def materialized_name(self) -> str:
        if not self.time_grain: return self.name
        g = self.time_grain.lower()
        return f"__{self.name}@{g}__"


class Measure[T](Field[T]): ...


class RowMeasure(Measure[Any]):
    def __init__(self, name: str, expr: ScalarExpr, agg: RowAgg = "mean"):
        super().__init__(name, FieldRole.COLUMN)
        self.expr, self.agg = expr, agg

    def dependencies(self) -> set[str]: return self.expr.dependencies()


class AggMeasure(Measure[Any]):
    def __init__(self, name: str, expr: AggExpr):
        super().__init__(name, FieldRole.COLUMN)
        self.expr = expr

    def dependencies(self) -> set[str]:
        return self.expr.dependencies() if hasattr(self.expr, "dependencies") else set()


# ---- 常用聚合表达式 ----
class Sum(AggExpr[float]):
    def __init__(self, expr: ScalarExpr | str): self.expr = _resolve_scalar(expr)

    @override
    def aggregate(self, df: pd.DataFrame, by: list[str]) -> pd.Series:
        s = self.expr.eval(df)
        key = make_group_key(df, by)
        return s.groupby(key).sum()

    def dependencies(self) -> set[str]: return self.expr.dependencies()


class Count(AggExpr[int]):
    def __init__(self, expr: ScalarExpr | str | None = None):
        self.expr = _resolve_scalar(expr) if expr is not None else None

    @override
    def aggregate(self, df: pd.DataFrame, by: list[str]) -> pd.Series:
        key = make_group_key(df, by)
        if self.expr is None:
            return key.groupby(key).size()
        s = self.expr.eval(df)
        return s.groupby(key).count()

    def dependencies(self) -> set[str]: return set() if self.expr is None else self.expr.dependencies()


class Avg(AggExpr[float]):
    def __init__(self, expr: ScalarExpr | str): self.expr = _resolve_scalar(expr)

    @override
    def aggregate(self, df: pd.DataFrame, by: list[str]) -> pd.Series:
        s = self.expr.eval(df)
        key = make_group_key(df, by)
        return s.groupby(key).mean()

    def dependencies(self) -> set[str]: return self.expr.dependencies()


class Min(AggExpr[Any]):
    def __init__(self, expr: ScalarExpr | str): self.expr = _resolve_scalar(expr)

    @override
    def aggregate(self, df: pd.DataFrame, by: list[str]) -> pd.Series:
        s = self.expr.eval(df)
        key = make_group_key(df, by)
        return s.groupby(key).min()

    def dependencies(self) -> set[str]: return self.expr.dependencies()


class Max(AggExpr[Any]):
    def __init__(self, expr: ScalarExpr | str): self.expr = _resolve_scalar(expr)

    @override
    def aggregate(self, df: pd.DataFrame, by: list[str]) -> pd.Series:
        s = self.expr.eval(df)
        key = make_group_key(df, by)
        return s.groupby(key).max()

    def dependencies(self) -> set[str]: return self.expr.dependencies()


class NUnique(AggExpr[int]):
    def __init__(self, expr: ScalarExpr | str): self.expr = _resolve_scalar(expr)

    @override
    def aggregate(self, df: pd.DataFrame, by: list[str]) -> pd.Series:
        s = self.expr.eval(df)
        key = make_group_key(df, by)
        return s.groupby(key).nunique(dropna=False)

    def dependencies(self) -> set[str]: return self.expr.dependencies()


class RatioOfSums(AggExpr[float]):
    def __init__(self, numerator: ScalarExpr | str, denominator: ScalarExpr | str, fill: float = 0.0):
        self.num, self.den, self.fill = _resolve_scalar(numerator), _resolve_scalar(denominator), fill

    @override
    def aggregate(self, df: pd.DataFrame, by: list[str]) -> pd.Series:
        key = make_group_key(df, by)
        n = self.num.eval(df).groupby(key).sum()
        d = self.den.eval(df).groupby(key).sum().replace({0: np.nan})
        return (n / d).fillna(self.fill)

    def dependencies(self) -> set[str]: return self.num.dependencies() | self.den.dependencies()


# ========= 5) 报表规范 =========
@dataclass(slots=True)
class SortBy:
    name: str
    ascending: bool = False


@dataclass(slots=True)
class ReportSpec:
    rows: list[Dimension]
    columns: list[Dimension]
    slicers: list[Dimension] = dc_field(default_factory=list)
    metrics: list[Measure] = dc_field(default_factory=list)
    where: PredicateExpr | None = None
    having: PredicateExpr | None = None
    sort_by: list[SortBy] = dc_field(default_factory=list)
    topn: int | None = None
    limit: int | None = None
    totals: bool = False

    # ---- 序列化 ----
    def to_dict(self) -> dict[str, Any]:
        return {
            "rows": [dimension_to_dict(d) for d in self.rows],
            "columns": [dimension_to_dict(d) for d in self.columns],
            "slicers": [dimension_to_dict(d) for d in self.slicers],
            "metrics": [measure_to_dict(m) for m in self.metrics],
            "where": predicate_to_dict(self.where) if self.where is not None else None,
            "having": predicate_to_dict(self.having) if self.having is not None else None,
            "sort_by": [{"name": s.name, "ascending": s.ascending} for s in self.sort_by],
            "topn": self.topn,
            "limit": self.limit,
            "totals": self.totals,
        }

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> "ReportSpec":
        return ReportSpec(
            rows=[dimension_from_dict(x) for x in d.get("rows", [])],
            columns=[dimension_from_dict(x) for x in d.get("columns", [])],
            slicers=[dimension_from_dict(x) for x in d.get("slicers", [])],
            metrics=[measure_from_dict(x) for x in d.get("metrics", [])],
            where=predicate_from_dict(d.get("where")) if d.get("where") is not None else None,
            having=predicate_from_dict(d.get("having")) if d.get("having") is not None else None,
            sort_by=[SortBy(**s) for s in d.get("sort_by", [])],
            topn=d.get("topn"),
            limit=d.get("limit"),
            totals=bool(d.get("totals", False)),
        )


@dataclass(slots=True)
class PivotResult:
    frames: dict[tuple, pd.DataFrame]
    slicer_names: list[str]

    def single(self) -> pd.DataFrame:
        if len(self.frames) != 1:
            raise ValueError("Multiple slices present; use frames[(...)] to select.")
        return next(iter(self.frames.values()))


# ========= 6) SQL ⇄ 谓词：SQLTokenizer / SQLMiniParser / SQLEmitter / SQLPredicate / SQLBridge =========
# ---- 6.1 SQLTokenizer ----
type TokType = str


@dataclass(slots=True)
class Token:
    t: TokType
    v: str


KW_SET = {"AND", "OR", "NOT", "IN", "BETWEEN", "IS", "NULL", "TRUE", "FALSE", "LIKE", "ILIKE"}


class SQLTokenizer:
    def __init__(self, s: str):
        self.s, self.i, self.n = s, 0, len(s)

    def _peek(self, k=0) -> str | None:
        j = self.i + k
        return self.s[j] if j < self.n else None

    def _adv(self, k=1):
        self.i += k

    def tokens(self) -> list[Token]:
        out: list[Token] = []
        while (c := self._peek()) is not None:
            if c.isspace(): self._adv(); continue
            if c == "-" and self._peek(1) == "-":
                while (cc := self._peek()) not in (None, "\n"): self._adv()
                continue
            if c == "/" and self._peek(1) == "*":
                self._adv(2)
                while not (self._peek() == "*" and self._peek(1) == "/"):
                    if self._peek() is None: break
                    self._adv()
                if self._peek() is not None: self._adv(2)
                continue
            if c == "(":
                out.append(Token("LP", "("));
                self._adv();
                continue
            if c == ")":
                out.append(Token("RP", ")"));
                self._adv();
                continue
            if c == ",":
                out.append(Token("COMMA", ","));
                self._adv();
                continue
            if c == "'":
                self._adv()
                buf = []
                while (cc := self._peek()) is not None:
                    if cc == "'":
                        if self._peek(1) == "''":
                            buf.append("'");
                            self._adv(2);
                            continue
                        else:
                            self._adv();
                            break
                    buf.append(cc);
                    self._adv()
                out.append(Token("STRING", "".join(buf)));
                continue
            if c in ('"', "`"):
                quote = c;
                self._adv()
                buf = []
                while (cc := self._peek()) is not None:
                    if cc == quote:
                        if self._peek(1) == quote:
                            buf.append(quote);
                            self._adv(2);
                            continue
                        else:
                            self._adv();
                            break
                    buf.append(cc);
                    self._adv()
                out.append(Token("IDENT", "".join(buf)));
                continue
            if c.isdigit() or (c == "." and (self._peek(1) or "").isdigit()):
                j = self.i;
                dot_seen = c == ".";
                self._adv()
                while (cc := self._peek()) and (cc.isdigit() or (cc == "." and not dot_seen)):
                    if cc == ".": dot_seen = True
                    self._adv()
                out.append(Token("NUMBER", self.s[j:self.i]));
                continue
            if c in "=!<>+-*/":
                two = (c or "") + (self._peek(1) or "")
                if two in {">=", "<=", "<>", "!="}: out.append(Token("OP", two)); self._adv(2); continue
                out.append(Token("OP", c));
                self._adv();
                continue
            if c.isalpha() or c == "_":
                j = self.i;
                self._adv()
                while (cc := self._peek()) and (cc.isalnum() or cc in "._$"):
                    self._adv()
                raw = self.s[j:self.i];
                up = raw.upper()
                out.append(Token("KW", up) if up in KW_SET else Token("IDENT", raw))
                continue
            raise SyntaxError(f"Unexpected char: {c!r} at {self.i}")
        return out


# ---- 6.2 SQLMiniParser ----
class SQLMiniParser:
    def __init__(self, dialect: Dialect):
        self.dialect = dialect
        self.toks: list[Token] = []
        self.i = 0

    def parse_predicate(self, sql: str) -> PredicateExpr:
        self.toks = SQLTokenizer(sql).tokens()
        self.i = 0
        expr = self._parse_or()
        if self._peek() is not None:
            raise SyntaxError(f"Trailing tokens: {self._peek()}")
        return expr

    # token helpers
    def _peek(self, k=0) -> Token | None:
        j = self.i + k
        return self.toks[j] if j < len(self.toks) else None

    def _match(self, t: TokType, v: str | None = None) -> bool:
        tok = self._peek()
        if tok and tok.t == t and (v is None or tok.v.upper() == v):
            self.i += 1
            return True
        return False

    def _expect(self, t: TokType, v: str | None = None) -> Token:
        tok = self._peek()
        if not tok or tok.t != t or (v is not None and tok.v.upper() != v):
            raise SyntaxError(f"Expected {t} {v or ''}, got {tok}")
        self.i += 1
        return tok

    # boolean precedence
    def _parse_or(self) -> PredicateExpr:
        left = self._parse_and()
        while self._match("KW", "OR"):
            right = self._parse_and()
            left = BoolOp(left, right, "or")
        return left

    def _parse_and(self) -> PredicateExpr:
        left = self._parse_not()
        while self._match("KW", "AND"):
            right = self._parse_not()
            left = BoolOp(left, right, "and")
        return left

    def _parse_not(self) -> PredicateExpr:
        if self._match("KW", "NOT"):
            return NotOp(self._parse_not())
        return self._pred_primary()

    def _pred_primary(self) -> PredicateExpr:
        if self._match("LP"):
            inner = self._parse_or()
            self._expect("RP")
            return inner

        left = self._parse_arith()

        # IS [NOT] NULL
        if self._match("KW", "IS"):
            is_not = self._match("KW", "NOT")
            self._expect("KW", "NULL")
            base = IsNull(left)
            return base if not is_not else NotOp(base)

        # [NOT] BETWEEN
        if self._match("KW", "NOT"):
            if self._match("KW", "BETWEEN"):
                lo = self._parse_arith()
                self._expect("KW", "AND")
                hi = self._parse_arith()
                return NotOp(Between(left, self._scalar_to_py(lo), self._scalar_to_py(hi), "both"))
            else:
                self.i -= 1  # 回退
        if self._match("KW", "BETWEEN"):
            lo = self._parse_arith()
            self._expect("KW", "AND")
            hi = self._parse_arith()
            return Between(left, self._scalar_to_py(lo), self._scalar_to_py(hi), "both")

        # [NOT] IN (...)
        saved_i = self.i
        if self._match("KW", "NOT"):
            if self._match("KW", "IN"):
                self._expect("LP")
                vals: list[Any] = []
                if not self._match("RP"):
                    vals.append(self._literal_to_value(self._expect_any_value()))
                    while self._match("COMMA"):
                        vals.append(self._literal_to_value(self._expect_any_value()))
                    self._expect("RP")
                return NotOp(InSet(left, vals))
            else:
                self.i = saved_i

        if self._match("KW", "IN"):
            self._expect("LP")
            vals: list[Any] = []
            if not self._match("RP"):
                vals.append(self._literal_to_value(self._expect_any_value()))
                while self._match("COMMA"):
                    vals.append(self._literal_to_value(self._expect_any_value()))
                self._expect("RP")
            return InSet(left, vals)

        # [NOT] ILIKE / [NOT] LIKE
        saved_i = self.i
        if self._match("KW", "NOT"):
            if self._match("KW", "ILIKE"):
                pat = self._parse_arith()
                return NotOp(LikePredicate(left, pat, case_insensitive=True, neg=False))
            if self._match("KW", "LIKE"):
                pat = self._parse_arith()
                return NotOp(LikePredicate(left, pat, case_insensitive=False, neg=False))
            self.i = saved_i
        if self._match("KW", "ILIKE"):
            pat = self._parse_arith()
            return LikePredicate(left, pat, case_insensitive=True, neg=False)
        if self._match("KW", "LIKE"):
            pat = self._parse_arith()
            return LikePredicate(left, pat, case_insensitive=False, neg=False)

        # 比较
        tok = self._peek()
        if tok and tok.t == "OP" and tok.v in {"=", "<>", "!=", ">", "<", ">=", "<="}:
            op = tok.v
            self.i += 1
            right = self._parse_arith()
            return Cmp(left, right, op)

        raise SyntaxError("Expected predicate after expression")

    # arithmetic
    def _parse_arith(self) -> ScalarExpr:
        left = self._parse_term()
        while True:
            tok = self._peek()
            if tok and tok.t == "OP" and tok.v in {"+", "-"}:
                self.i += 1
                right = self._parse_term()
                left = BinaryOp(left, right, _op_fn(tok.v), tok.v)
            else:
                break
        return left

    def _parse_term(self) -> ScalarExpr:
        left = self._parse_factor()
        while True:
            tok = self._peek()
            if tok and tok.t == "OP" and tok.v in {"*", "/"}:
                self.i += 1
                right = self._parse_factor()
                left = BinaryOp(left, right, _op_fn(tok.v), tok.v)
            else:
                break
        return left

    def _parse_factor(self) -> ScalarExpr:
        if self._match("OP", "-"):
            inner = self._parse_factor()
            return BinaryOp(Literal(0), inner, _op_fn("-"), "-")
        if self._match("LP"):
            inner = self._parse_arith()
            self._expect("RP")
            return inner
        tok = self._peek()
        if tok is None: raise SyntaxError("Unexpected EOF in factor")
        self.i += 1
        match tok.t:
            case "IDENT":
                return ColumnRef(tok.v)
            case "STRING":
                return Literal(tok.v)
            case "NUMBER":
                return Literal(float(tok.v) if "." in tok.v else int(tok.v))
            case "KW":
                up = tok.v.upper()
                if up == "NULL":  return Literal(None)
                if up == "TRUE":  return Literal(True)
                if up == "FALSE": return Literal(False)
                return ColumnRef(tok.v)
            case _:
                raise SyntaxError(f"Unexpected token in factor: {tok}")

    def _expect_any_value(self) -> Token:
        tok = self._peek()
        if not tok or tok.t not in {"STRING", "NUMBER", "KW", "IDENT"}:
            raise SyntaxError(f"Expected value literal, got {tok}")
        self.i += 1
        return tok

    def _literal_to_value(self, tok: Token) -> Any:
        match tok.t:
            case "STRING":
                return tok.v
            case "NUMBER":
                return float(tok.v) if "." in tok.v else int(tok.v)
            case "KW":
                if tok.v == "NULL": return None
                if tok.v == "TRUE": return True
                if tok.v == "FALSE": return False
        return tok.v

    def _scalar_to_py(self, s: ScalarExpr) -> Any:
        match s:
            case Literal(v):
                return v
            case _:
                raise SyntaxError("BETWEEN bounds must be literals")


# ---- 6.3 SQLEmitter：表达式/谓词/度量 -> 目标方言 SQL 片段 ----
class SQLEmitter:
    def __init__(self, dialect: Dialect):
        self.dialect = dialect

    def q(self, ident: str) -> str:
        quote = "`" if self.dialect is Dialect.BIGQUERY else '"'
        if ident.startswith(quote) and ident.endswith(quote):
            return ident
        if "." in ident:
            parts = ident.split(".")
            return ".".join(self.q(p) for p in parts)
        return f"{quote}{ident.replace(quote, quote * 2)}{quote}"

    def lit(self, v: Any) -> str:
        if v is None: return "NULL"
        if isinstance(v, bool): return "TRUE" if v else "FALSE"
        if isinstance(v, (int, float, np.number)): return str(v)
        s = str(v).replace("'", "''")
        return f"'{s}'"

    # 注意：在带 SQL 的类（SQLEmitter）中，方法名不含 `sql`，且全部小写
    def scalar(self, e: ScalarExpr, alias_map: dict[str, str] | None = None) -> str:
        match e:
            case ColumnRef(name):
                if alias_map and name in alias_map:
                    return f"({alias_map[name]})"
                return self.q(name)
            case Literal(value):
                return self.lit(value)
            case BinaryOp(left, right, _, symbol):
                ls = self.scalar(left, alias_map)
                rs = self.scalar(right, alias_map)
                if symbol == "||":
                    if self.dialect is Dialect.BIGQUERY:
                        return f"CONCAT(CAST({ls} AS STRING), CAST({rs} AS STRING))"
                    return f"(CAST({ls} AS VARCHAR) || CAST({rs} AS VARCHAR))"
                return f"({ls} {symbol} {rs})"
            case SafeDiv(numer, denom, fill):
                n = self.scalar(numer, alias_map)
                d = self.scalar(denom, alias_map)
                if self.dialect is Dialect.BIGQUERY:
                    return f"SAFE_DIVIDE(CAST({n} AS FLOAT64), CAST({d} AS FLOAT64))"
                return f"(CAST({n} AS DOUBLE) / NULLIF(CAST({d} AS DOUBLE), 0))"
            case Coalesce(exprs):
                inner = ", ".join(self.scalar(x, alias_map) for x in exprs)
                return f"COALESCE({inner})"
            case CaseWhen(whens, otherwise):
                parts: list[str] = []
                for cond, val in whens:
                    parts.append(f"WHEN {self.predicate(cond, alias_map)} THEN {self.scalar(val, alias_map)}")
                else_part = f" ELSE {self.scalar(otherwise, alias_map)}" if otherwise is not None else ""
                return f"(CASE {' '.join(parts)}{else_part} END)"
            case _:
                raise NotImplementedError(f"Scalar to SQL not implemented for {type(e)}")

    def predicate(self, p: PredicateExpr, alias_map: dict[str, str] | None = None) -> str:
        if isinstance(p, SQLPredicate):
            p = p.as_inner()
        match p:
            case Cmp(left, right, op):
                op_sql = (
                    "=" if op in ("==", "=") else
                    "<>" if op == "<>" else
                    "!=" if op == "!=" else op
                )
                return f"({self.scalar(left, alias_map)} {op_sql} {self.scalar(right, alias_map)})"
            case InSet(expr, values):
                vals = ", ".join(self.lit(v) for v in values)
                return f"({self.scalar(expr, alias_map)} IN ({vals}))"
            case Between(expr, left, right, inclusive):
                v = self.scalar(expr, alias_map)
                ol = ">=" if inclusive in ("both", "left") else ">"
                or_ = "<=" if inclusive in ("both", "right") else "<"
                return f"({v} {ol} {self.lit(left)} AND {v} {or_} {self.lit(right)})"
            case IsNull(expr):
                return f"({self.scalar(expr, alias_map)} IS NULL)"
            case BoolOp(left, right, op):
                joiner = "AND" if op == "and" else "OR"
                return f"({self.predicate(left, alias_map)} {joiner} {self.predicate(right, alias_map)})"
            case NotOp(inner):
                return f"(NOT {self.predicate(inner, alias_map)})"
            case LikePredicate(expr, pattern, ci, neg):
                col_sql = self.scalar(expr, alias_map)
                pat_sql = self.scalar(pattern, alias_map)
                if ci:
                    if self.dialect is Dialect.DUCKDB:
                        core = f"{col_sql} ILIKE {pat_sql}"
                    else:
                        core = f"LOWER({col_sql}) LIKE LOWER({pat_sql})"
                else:
                    core = f"{col_sql} LIKE {pat_sql}"
                return f"(NOT {core})" if neg else f"({core})"
            case RegexPredicate(expr, pattern, flags, neg):
                col_sql = self.scalar(expr, alias_map)
                pat_sql = self.scalar(pattern, alias_map)
                if self.dialect is Dialect.BIGQUERY:
                    flag = ", 'i'" if "i" in flags.lower() else ""
                    core = f"REGEXP_CONTAINS({col_sql}, {pat_sql}{flag})"
                elif self.dialect is Dialect.DUCKDB:
                    if "i" in flags.lower():
                        core = f"REGEXP_MATCHES({col_sql}, CONCAT('(?i)', {pat_sql}))"
                    else:
                        core = f"REGEXP_MATCHES({col_sql}, {pat_sql})"
                else:
                    core = f"REGEXP_LIKE({col_sql}, {pat_sql})"
                return f"(NOT {core})" if neg else f"({core})"
            case _:
                raise NotImplementedError(f"Predicate to SQL not implemented for {type(p)}")

    def agg_of_measure(self, m: Measure) -> tuple[str, str]:
        if isinstance(m, AggMeasure):
            match m.expr:
                case Sum(expr):
                    return (f"SUM({self.scalar(expr)})", self.q(m.name))
                case Avg(expr):
                    return (f"AVG({self.scalar(expr)})", self.q(m.name))
                case Min(expr):
                    return (f"MIN({self.scalar(expr)})", self.q(m.name))
                case Max(expr):
                    return (f"MAX({self.scalar(expr)})", self.q(m.name))
                case Count(expr):
                    if expr.expr is None: return ("COUNT(*)", self.q(m.name))
                    return (f"COUNT({self.scalar(expr.expr)})", self.q(m.name))
                case NUnique(expr):
                    return (f"COUNT(DISTINCT {self.scalar(expr)})", self.q(m.name))
                case RatioOfSums(num, den, _fill):
                    if self.dialect is Dialect.BIGQUERY:
                        return (f"SAFE_DIVIDE(SUM({self.scalar(num)}), SUM({self.scalar(den)}))", self.q(m.name))
                    return (f"(SUM({self.scalar(num)}) / NULLIF(SUM({self.scalar(den)}), 0))", self.q(m.name))
                case _:
                    raise NotImplementedError(f"AggExpr SQL not implemented: {type(m.expr)}")
        elif isinstance(m, RowMeasure):
            expr_sql = self.scalar(m.expr)
            match m.agg:
                case "sum":
                    return (f"SUM({expr_sql})", self.q(m.name))
                case "mean":
                    return (f"AVG({expr_sql})", self.q(m.name))
                case "min":
                    return (f"MIN({expr_sql})", self.q(m.name))
                case "max":
                    return (f"MAX({expr_sql})", self.q(m.name))
                case "count":
                    return (f"COUNT({expr_sql})", self.q(m.name))
                case "nunique":
                    return (f"COUNT(DISTINCT {expr_sql})", self.q(m.name))
                case other:
                    raise ValueError(f"Unsupported RowAgg: {other}")
        else:
            raise TypeError(f"Unknown measure type: {type(m)}")


# ---- 6.4 SQLPredicate：SQL 直接作为 PredicateExpr 使用（懒解析） ----
class SQLPredicate(PredicateExpr):
    def __init__(self, sql: str, dialect: Dialect = Dialect.ANSI, *, strip_prefix: bool = True):
        self.sql = sql.strip()
        self.dialect = dialect
        self.strip_prefix = strip_prefix
        self._inner: PredicateExpr | None = None

    def _strip_clause(self, s: str) -> str:
        up = s.lstrip().upper()
        if self.strip_prefix:
            if up.startswith("WHERE "):  return s.lstrip()[6:].lstrip()
            if up.startswith("HAVING "): return s.lstrip()[7:].lstrip()
        return s

    def as_inner(self) -> PredicateExpr:
        if self._inner is None:
            core = self._strip_clause(self.sql)
            self._inner = SQLMiniParser(self.dialect).parse_predicate(core)
        return self._inner

    @override
    def eval(self, df: pd.DataFrame) -> pd.Series:
        return self.as_inner().eval(df)

    @override
    def dependencies(self) -> set[str]:
        return self.as_inner().dependencies()

    def __repr__(self) -> str:
        return f"<SQLPredicate dialect={self.dialect} sql={self.sql!r}>"


# 便捷工厂（函数名不再使用全大写 SQL，保持小写）
def sql_ansi(where_sql: str) -> SQLPredicate:     return SQLPredicate(where_sql, dialect=Dialect.ANSI)


def sql_duckdb(where_sql: str) -> SQLPredicate:   return SQLPredicate(where_sql, dialect=Dialect.DUCKDB)


def sql_bigquery(where_sql: str) -> SQLPredicate: return SQLPredicate(where_sql, dialect=Dialect.BIGQUERY)


# ---- 6.5 SQLBridge：工具入口（方法名不含 `sql`，全小写） ----
class SQLBridge:
    def predicate(self, pred: PredicateExpr, dialect: Dialect,
                  alias_map: dict[str, str] | None = None) -> str:
        return SQLEmitter(dialect).predicate(pred, alias_map)

    def scalar(self, expr: ScalarExpr, dialect: Dialect) -> str:
        return SQLEmitter(dialect).scalar(expr)

    def agg_map(self, metrics: list[Measure], dialect: Dialect) -> dict[str, str]:
        em = SQLEmitter(dialect)
        return {m.name: em.agg_of_measure(m)[0] for m in metrics}

    def parse(self, sql: str, dialect: Dialect) -> PredicateExpr:
        return SQLMiniParser(dialect).parse_predicate(sql)


# ========= 7) Planner & Engine（Pandas/DuckDB/BigQuery） =========
class Dataset:
    """本地数据集（Pandas DataFrame）。外部引擎（DuckDB/BigQuery）可忽略其中 df。"""

    def __init__(self, df: pd.DataFrame): self.df = df

    def report(self, spec: ReportSpec, engine: "Engine" | None = None) -> PivotResult:
        engine = engine or PandasEngine()
        planner = Planner(engine)
        return planner.run(self, spec)


@dataclass(slots=True)
class Plan:
    group_keys: list[str]
    metric_names: list[str]


class Engine:
    def execute(self, dataset: Dataset, spec: ReportSpec, plan: Plan) -> PivotResult:
        raise NotImplementedError


class Planner:
    def __init__(self, engine: Engine):
        self.engine = engine

    def compile(self, dataset: Dataset, spec: ReportSpec) -> Plan:
        df = dataset.df
        keys: list[str] = []

        # 本地引擎（Pandas/DuckDB）时物化列；BigQuery 仅取“物化名”
        local = isinstance(self.engine, (PandasEngine, DuckDBEngine))
        for dim in [*spec.rows, *spec.columns, *spec.slicers]:
            if local:
                name, series = dim.materialize(df)
                if name not in df.columns: df[name] = series
                keys.append(name)
            else:
                keys.append(dim.materialized_name())
        metric_names = [m.name for m in spec.metrics]
        return Plan(group_keys=keys, metric_names=metric_names)

    def run(self, dataset: Dataset, spec: ReportSpec) -> PivotResult:
        plan = self.compile(dataset, spec)
        return self.engine.execute(dataset, spec, plan)


# ---- 7.1 公共排序/总计/透视 ----
def _with_totals(df_slice: pd.DataFrame, totals: bool) -> pd.DataFrame:
    if not totals: return df_slice
    total = pd.DataFrame(df_slice.sum(numeric_only=True)).T
    total.index = ["__TOTAL__"]
    return pd.concat([df_slice, total], axis=0)


def _sort_limit(df_slice: pd.DataFrame, spec: ReportSpec) -> pd.DataFrame:
    has_totals_row = "__TOTAL__" in df_slice.index
    if has_totals_row:
        totals = df_slice.loc[["__TOTAL__"]]
        data = df_slice.drop(index="__TOTAL__")
    else:
        data = df_slice
    by: list[str] = []
    asc: list[bool] = []
    for s in spec.sort_by:
        target = s.name if s.name in data.columns else next((c for c in data.columns if c.split(" / ")[0] == s.name),
                                                            None)
        if target: by.append(target); asc.append(s.ascending)
    if by:
        data = data.sort_values(by=by, ascending=asc, kind="mergesort")
    if spec.topn is not None:  data = data.head(spec.topn)
    if spec.limit is not None: data = data.head(spec.limit)
    if has_totals_row:
        data = pd.concat([data, totals], axis=0)
    return data


def ensure_predicate(clause: PredicateExpr | str | None, dialect: Dialect = Dialect.ANSI) -> PredicateExpr | None:
    if clause is None: return None
    if isinstance(clause, PredicateExpr): return clause
    if isinstance(clause, str): return SQLPredicate(clause, dialect=dialect)
    raise TypeError(f"Unsupported where/having type: {type(clause)}")


def _pivot_frames(grouped_df: pd.DataFrame,
                  row_names: list[str],
                  col_names: list[str],
                  slicer_names: list[str],
                  metrics: list[str] | None,
                  spec: ReportSpec) -> dict[tuple, pd.DataFrame]:
    """统一透视/切片/排序，供各引擎复用。"""
    metrics = metrics or ["rows"]
    if col_names:
        pivoted = grouped_df.pivot_table(
            index=row_names + slicer_names,
            columns=col_names,
            values=metrics,
            aggfunc="first",
            observed=False
        )
        pivoted.columns = _flatten_multi_columns(pivoted.columns.to_flat_index())
        pivoted = pivoted.sort_index(axis=1)
    else:
        pivoted = grouped_df.set_index(row_names + slicer_names)[metrics]

    frames: dict[tuple, pd.DataFrame] = {}
    if slicer_names:
        reset = pivoted.reset_index()
        for keys, sub in reset.groupby(slicer_names, dropna=False, sort=False):
            if not isinstance(keys, tuple): keys = (keys,)
            slice_df = sub.drop(columns=slicer_names).set_index(row_names)
            frames[keys] = _sort_limit(_with_totals(slice_df, spec.totals), spec)
    else:
        df2 = pivoted if isinstance(pivoted, pd.DataFrame) else pivoted.to_frame()
        frames[()] = _sort_limit(_with_totals(df2, spec.totals), spec)
    return frames


# ---- 7.2 PandasEngine ----
class PandasEngine(Engine):
    @override
    def execute(self, dataset: Dataset, spec: ReportSpec, plan: Plan) -> PivotResult:
        df = dataset.df.copy()

        # WHERE
        where_pred = ensure_predicate(spec.where)
        if where_pred is not None:
            df = df[where_pred.eval(df)]

        # materialized keys（Planner 已加过）
        row_names = [d.materialized_name() for d in spec.rows]
        col_names = [d.materialized_name() for d in spec.columns]
        slicer_names = [d.materialized_name() for d in spec.slicers]
        group_keys = row_names + col_names + slicer_names

        # 行级度量
        for m in spec.metrics:
            if isinstance(m, RowMeasure):
                df[f"__row_{m.name}__"] = m.expr.eval(df)

        key = make_group_key(df, group_keys) if group_keys else pd.Series([0] * len(df), index=df.index)

        # 聚合
        series_list: list[pd.Series] = []
        for m in spec.metrics:
            if isinstance(m, AggMeasure):
                s = m.expr.aggregate(df, group_keys)
                s.name = m.name
                series_list.append(s)
            elif isinstance(m, RowMeasure):
                tmp = df[f"__row_{m.name}__"]
                match m.agg:
                    case "sum":
                        s = tmp.groupby(key).sum()
                    case "mean":
                        s = tmp.groupby(key).mean()
                    case "min":
                        s = tmp.groupby(key).min()
                    case "max":
                        s = tmp.groupby(key).max()
                    case "count":
                        s = tmp.groupby(key).count()
                    case "nunique":
                        s = tmp.groupby(key).nunique(dropna=False)
                    case other:
                        raise ValueError(f"Unsupported RowAgg: {other}")
                s.name = m.name
                series_list.append(s)
            else:
                raise TypeError(f"Unknown measure type: {type(m)}")

        if not series_list:
            s = key.groupby(key).size()
            s.name = "rows"
            series_list.append(s)

        grouped_df = pd.concat(series_list, axis=1)

        if group_keys:
            gk_df = df[group_keys].copy()
            gk_df["__k__"] = key.values
            gk_df = gk_df.drop_duplicates("__k__").set_index("__k__")
            grouped_df = gk_df.join(grouped_df, how="right")

        # HAVING（聚合后）
        having_pred = ensure_predicate(spec.having)
        if having_pred is not None:
            grouped_df = grouped_df[having_pred.eval(grouped_df)]

        # 透视/切片/排序（统一）
        metrics = [m.name for m in spec.metrics] or ["rows"]
        frames = _pivot_frames(grouped_df, row_names, col_names, slicer_names, metrics, spec)
        return PivotResult(frames=frames, slicer_names=slicer_names)


# ---- 7.3 DuckDBEngine（把聚合下推给 DuckDB；透视/切片/排序仍在本地） ----
class DuckDBEngine(Engine):
    def __init__(self, db_path: str | None = None):
        self.db_path = db_path

    @override
    def execute(self, dataset: Dataset, spec: ReportSpec, plan: Plan) -> PivotResult:
        try:
            import duckdb  # type: ignore
        except Exception as e:
            raise RuntimeError("请先 `pip install duckdb` 再使用 DuckDBEngine") from e

        df = dataset.df.copy()
        em = SQLEmitter(Dialect.DUCKDB)

        # WHERE
        where_pred = ensure_predicate(spec.where, dialect=Dialect.DUCKDB)
        where_sql = em.predicate(where_pred) if where_pred is not None else None

        # 分组键
        row_names = [d.materialized_name() for d in spec.rows]
        col_names = [d.materialized_name() for d in spec.columns]
        slicer_names = [d.materialized_name() for d in spec.slicers]
        group_keys = row_names + col_names + slicer_names

        select_keys_exprs = ", ".join(em.q(k) for k in group_keys) if group_keys else ""
        agg_cols = [em.agg_of_measure(m) for m in spec.metrics] or [("COUNT(*)", em.q("rows"))]
        alias_map = {m.name: sql for m, (sql, _alias) in zip(spec.metrics, agg_cols)}
        select_aggs = ", ".join(f"{expr} AS {alias}" for expr, alias in agg_cols)
        select_list = f"{select_keys_exprs}, {select_aggs}" if select_keys_exprs else select_aggs
        group_by = f" GROUP BY {', '.join(str(i + 1) for i, _ in enumerate(group_keys))}" if group_keys else ""

        sql = f"SELECT {select_list} FROM df"
        if where_sql: sql += f" WHERE {where_sql}"
        sql += group_by

        # HAVING（支持别名）
        having_pred = ensure_predicate(spec.having, dialect=Dialect.DUCKDB)
        if having_pred is not None:
            sql += f" HAVING {em.predicate(having_pred, alias_map=alias_map)}"

        con = duckdb.connect(self.db_path) if self.db_path else duckdb.connect()
        try:
            con.register("df", df)
            grouped = con.sql(sql).df()
        finally:
            con.close()

        # 透视/切片/排序（统一）
        metrics = [m.name for m in spec.metrics] or ["rows"]
        frames = _pivot_frames(grouped, row_names, col_names, slicer_names, metrics, spec)
        return PivotResult(frames=frames, slicer_names=slicer_names)


# ---- 7.4 BigQueryEngine（聚合下推到 BigQuery；透视等在本地） ----
class BigQueryEngine(Engine):
    """
    参数：
      - project: GCP 项目ID
      - dataset: BigQuery 数据集名
      - table:   表名（不含项目/数据集）
      - credentials: 默认凭据或自定义（按需扩展）
    """

    def __init__(self, project: str, dataset: str, table: str, *, credentials: Any | None = None,
                 location: str | None = None):
        self.project = project
        self.dataset = dataset
        self.table = table
        self.credentials = credentials
        self.location = location

    def _full_table_id(self) -> str:
        return f"{self.project}.{self.dataset}.{self.table}"

    def _dim_sql(self, em: SQLEmitter, dim: Dimension) -> tuple[str, str]:
        # 返回 (expr_sql, alias)；时间粒度用 DATE_TRUNC(DATE(col), GRAIN)
        if not dim.time_grain:
            return (em.q(dim.name), em.q(dim.materialized_name()))
        g = dim.time_grain.lower()
        col = em.q(dim.name)
        grain_map = {
            "day": "DAY", "d": "DAY",
            "week": "WEEK", "w": "WEEK",
            "month": "MONTH", "m": "MONTH",
            "quarter": "QUARTER", "q": "QUARTER",
            "year": "YEAR", "y": "YEAR",
        }
        if g not in grain_map:
            raise ValueError(f"Unsupported time_grain for BigQuery: {dim.time_grain}")
        expr = f"DATE_TRUNC(DATE({col}), {grain_map[g]})"
        return (expr, em.q(dim.materialized_name()))

    @override
    def execute(self, dataset: Dataset, spec: ReportSpec, plan: Plan) -> PivotResult:
        try:
            from google.cloud import bigquery  # type: ignore
        except Exception as e:
            raise RuntimeError("请先 `pip install google-cloud-bigquery` 并配置凭据后使用 BigQueryEngine") from e

        em = SQLEmitter(Dialect.BIGQUERY)

        # WHERE
        where_pred = ensure_predicate(spec.where, dialect=Dialect.BIGQUERY)
        where_sql = em.predicate(where_pred) if where_pred is not None else None

        # 分组键：为每个维度生成 SQL 表达式 + 别名
        row_dims = [self._dim_sql(em, d) for d in spec.rows]
        col_dims = [self._dim_sql(em, d) for d in spec.columns]
        slicer_dims = [self._dim_sql(em, d) for d in spec.slicers]
        group_dims = row_dims + col_dims + slicer_dims

        select_keys_exprs = ", ".join(f"{expr} AS {alias}" for (expr, alias) in group_dims) if group_dims else ""
        agg_cols = [em.agg_of_measure(m) for m in spec.metrics] or [("COUNT(*)", em.q("rows"))]
        alias_map = {m.name: sql for m, (sql, _alias) in zip(spec.metrics, agg_cols)}
        select_aggs = ", ".join(f"{expr} AS {alias}" for expr, alias in agg_cols)
        select_list = f"{select_keys_exprs}, {select_aggs}" if select_keys_exprs else select_aggs
        group_by = f" GROUP BY {', '.join(str(i + 1) for i, _ in enumerate(group_dims))}" if group_dims else ""

        sql = f"SELECT {select_list} FROM `{self._full_table_id()}`"
        if where_sql: sql += f" WHERE {where_sql}"
        sql += group_by

        # HAVING（支持别名映射为真实聚合式）
        having_pred = ensure_predicate(spec.having, dialect=Dialect.BIGQUERY)
        if having_pred is not None:
            sql += f" HAVING {em.predicate(having_pred, alias_map=alias_map)}"

        # 执行
        client_kwargs = {"project": self.project}
        if self.location: client_kwargs["location"] = self.location
        if self.credentials is not None:
            client_kwargs["credentials"] = self.credentials
        client = bigquery.Client(**client_kwargs)
        job = client.query(sql)
        grouped = job.result().to_dataframe(create_bqstorage_client=True)

        # 透视/切片/排序（统一）
        row_names = [d.materialized_name() for d in spec.rows]
        col_names = [d.materialized_name() for d in spec.columns]
        slicer_names = [d.materialized_name() for d in spec.slicers]
        metrics = [m.name for m in spec.metrics] or ["rows"]

        frames = _pivot_frames(grouped, row_names, col_names, slicer_names, metrics, spec)
        return PivotResult(frames=frames, slicer_names=slicer_names)


# ========= 8) 旧接口适配（可选保留） =========
class EqualFilter:
    def __init__(self, field: str, value: Any): self.field, self.value = field, value

    def to_predicate(self) -> PredicateExpr: return col(self.field).eq(lit(self.value))


class IncludeFilter:
    def __init__(self, field: str, values: Sequence[Any]): self.field, self.values = field, list(values)

    def to_predicate(self) -> PredicateExpr: return col(self.field).isin(self.values)


def adapt_where(filters: Sequence[PredicateExpr | EqualFilter | IncludeFilter]) -> PredicateExpr | None:
    pred: PredicateExpr | None = None
    for f in filters:
        p = f if isinstance(f, PredicateExpr) else f.to_predicate()
        pred = p if pred is None else (pred & p)
    return pred


# ========= 9) JSON 序列化（Expr / Predicate / AggExpr / Measure / Dimension） =========
def dimension_to_dict(d: Dimension) -> dict[str, Any]:
    return {
        "type": "dimension",
        "name": d.name,
        "role": d.role.value,
        "levels": list(d.levels),
        "time_grain": d.time_grain,
    }


def dimension_from_dict(d: Mapping[str, Any]) -> Dimension:
    return Dimension(
        name=d["name"],
        role=FieldRole(d.get("role", "row")),
        levels=list(d.get("levels", [])),
        time_grain=d.get("time_grain"),
    )


def scalar_to_dict(e: ScalarExpr) -> dict[str, Any]:
    match e:
        case ColumnRef(name):
            return {"kind": "column", "name": name}
        case Literal(value):
            return {"kind": "literal", "value": value}
        case BinaryOp(left, right, _, symbol):
            return {"kind": "binary", "op": symbol, "left": scalar_to_dict(left), "right": scalar_to_dict(right)}
        case SafeDiv(numer, denom, fill):
            return {"kind": "safe_div", "numerator": scalar_to_dict(numer), "denominator": scalar_to_dict(denom),
                    "fill": fill}
        case Coalesce(exprs):
            return {"kind": "coalesce", "exprs": [scalar_to_dict(x) for x in exprs]}
        case CaseWhen(whens, otherwise):
            return {
                "kind": "case_when",
                "whens": [{"when": predicate_to_dict(c), "then": scalar_to_dict(v)} for c, v in whens],
                "otherwise": (scalar_to_dict(otherwise) if otherwise is not None else None)
            }
        case _:
            raise TypeError(f"Cannot serialize ScalarExpr: {type(e)}")


def scalar_from_dict(d: Mapping[str, Any]) -> ScalarExpr:
    kind = d["kind"]
    if kind == "column":   return col(d["name"])
    if kind == "literal":  return lit(d["value"])
    if kind == "binary":
        op = d["op"]
        return BinaryOp(scalar_from_dict(d["left"]), scalar_from_dict(d["right"]), _op_fn(op), op)
    if kind == "safe_div": return SafeDiv(scalar_from_dict(d["numerator"]), scalar_from_dict(d["denominator"]),
                                          d.get("fill", 0.0))
    if kind == "coalesce": return Coalesce(*[scalar_from_dict(x) for x in d["exprs"]])
    if kind == "case_when":
        whens = [(predicate_from_dict(w["when"]), scalar_from_dict(w["then"])) for w in d["whens"]]
        other = scalar_from_dict(d["otherwise"]) if d.get("otherwise") is not None else None
        return CaseWhen(whens, other)
    raise ValueError(f"Unknown scalar kind: {kind}")


def predicate_to_dict(p: PredicateExpr) -> dict[str, Any]:
    if isinstance(p, SQLPredicate):
        return {"kind": "sql", "sql": p.sql, "dialect": p.dialect.value}
    match p:
        case Cmp(left, right, op):
            return {"kind": "cmp", "op": op, "left": scalar_to_dict(left), "right": scalar_to_dict(right)}
        case InSet(expr, values):
            return {"kind": "in", "expr": scalar_to_dict(expr), "values": list(values)}
        case Between(expr, left, right, inclusive):
            return {"kind": "between", "expr": scalar_to_dict(expr), "left": left, "right": right,
                    "inclusive": inclusive}
        case IsNull(expr):
            return {"kind": "is_null", "expr": scalar_to_dict(expr)}
        case BoolOp(left, right, op):
            return {"kind": "bool", "op": op, "left": predicate_to_dict(left), "right": predicate_to_dict(right)}
        case NotOp(inner):
            return {"kind": "not", "expr": predicate_to_dict(inner)}
        case LikePredicate(expr, pattern, ci, neg):
            return {"kind": "like", "expr": scalar_to_dict(expr), "pattern": scalar_to_dict(pattern), "ci": ci,
                    "neg": neg}
        case RegexPredicate(expr, pattern, flags, neg):
            return {"kind": "regex", "expr": scalar_to_dict(expr), "pattern": scalar_to_dict(pattern), "flags": flags,
                    "neg": neg}
        case _:
            raise TypeError(f"Cannot serialize PredicateExpr: {type(p)}")


def predicate_from_dict(d: Mapping[str, Any] | None) -> PredicateExpr | None:
    if d is None: return None
    kind = d.get("kind")
    if kind == "sql":
        dialect = Dialect(d.get("dialect", "ansi"))
        return SQLPredicate(d["sql"], dialect=dialect)
    if kind == "cmp":      return Cmp(scalar_from_dict(d["left"]), scalar_from_dict(d["right"]), d["op"])
    if kind == "in":       return InSet(scalar_from_dict(d["expr"]), list(d["values"]))
    if kind == "between":  return Between(scalar_from_dict(d["expr"]), d["left"], d["right"],
                                          d.get("inclusive", "both"))
    if kind == "is_null":  return IsNull(scalar_from_dict(d["expr"]))
    if kind == "bool":     return BoolOp(predicate_from_dict(d["left"]), predicate_from_dict(d["right"]), d["op"])
    if kind == "not":      return NotOp(predicate_from_dict(d["expr"]))
    if kind == "like":     return LikePredicate(scalar_from_dict(d["expr"]), scalar_from_dict(d["pattern"]),
                                                d.get("ci", False), d.get("neg", False))
    if kind == "regex":    return RegexPredicate(scalar_from_dict(d["expr"]), scalar_from_dict(d["pattern"]),
                                                 d.get("flags", ""), d.get("neg", False))
    raise ValueError(f"Unknown predicate kind: {kind}")


def aggexpr_to_dict(a: AggExpr) -> dict[str, Any]:
    match a:
        case Sum(expr):
            return {"kind": "sum", "expr": scalar_to_dict(expr)}
        case Avg(expr):
            return {"kind": "avg", "expr": scalar_to_dict(expr)}
        case Min(expr):
            return {"kind": "min", "expr": scalar_to_dict(expr)}
        case Max(expr):
            return {"kind": "max", "expr": scalar_to_dict(expr)}
        case Count(expr):
            return {"kind": "count", "expr": (scalar_to_dict(expr.expr) if expr.expr is not None else None)}
        case NUnique(expr):
            return {"kind": "nunique", "expr": scalar_to_dict(expr)}
        case RatioOfSums(num, den, fill):
            return {"kind": "ratio_of_sums", "numerator": scalar_to_dict(num), "denominator": scalar_to_dict(den),
                    "fill": fill}
        case _:
            raise TypeError(f"Cannot serialize AggExpr: {type(a)}")


def aggexpr_from_dict(d: Mapping[str, Any]) -> AggExpr:
    kind = d["kind"]
    if kind == "sum": return Sum(scalar_from_dict(d["expr"]))
    if kind == "avg": return Avg(scalar_from_dict(d["expr"]))
    if kind == "min": return Min(scalar_from_dict(d["expr"]))
    if kind == "max": return Max(scalar_from_dict(d["expr"]))
    if kind == "count":
        expr_json = d.get("expr")
        return Count(None if expr_json is None else scalar_from_dict(expr_json))
    if kind == "nunique": return NUnique(scalar_from_dict(d["expr"]))
    if kind == "ratio_of_sums":
        return RatioOfSums(scalar_from_dict(d["numerator"]), scalar_from_dict(d["denominator"]), d.get("fill", 0.0))
    raise ValueError(f"Unknown agg kind: {kind}")


def measure_to_dict(m: Measure) -> dict[str, Any]:
    if isinstance(m, RowMeasure):
        return {"type": "row_measure", "name": m.name, "agg": m.agg, "expr": scalar_to_dict(m.expr)}
    if isinstance(m, AggMeasure):
        return {"type": "agg_measure", "name": m.name, "agg_expr": aggexpr_to_dict(m.expr)}
    raise TypeError(f"Cannot serialize Measure: {type(m)}")


def measure_from_dict(d: Mapping[str, Any]) -> Measure:
    t = d["type"]
    if t == "row_measure":
        return RowMeasure(d["name"], scalar_from_dict(d["expr"]), agg=d.get("agg", "mean"))
    if t == "agg_measure":
        return AggMeasure(d["name"], aggexpr_from_dict(d["agg_expr"]))
    raise ValueError(f"Unknown measure type: {t}")


# ========= 10) 最小 Demo =========
if __name__ == "__main__":
    # 构造示例数据
    data = pd.DataFrame({
        "Campaign": ["A", "A", "A", "B", "B", "B"] * 2,
        "Device": ["Mobile", "Desktop", "Tablet"] * 4,
        "Date": pd.to_datetime([
            "2025-05-01", "2025-05-01", "2025-05-01", "2025-05-01", "2025-05-01", "2025-05-01",
            "2025-06-01", "2025-06-01", "2025-06-01", "2025-06-01", "2025-06-01", "2025-06-01",
        ]),
        "Country": ["US", "US", "US", "CA", "CA", "CA", "US", "US", "US", "CA", "CA", "CA"],
        "clicks": [100, 80, 20, 60, 40, 10, 150, 90, 30, 70, 50, 20],
        "impr": [500, 400, 100, 300, 200, 50, 700, 500, 150, 350, 250, 60],
        "cost": [80, 64, 16, 48, 32, 8, 120, 72, 24, 56, 40, 16],
        "revenue": [200, 160, 40, 120, 80, 20, 300, 200, 60, 140, 100, 40],
    })

    dataset = Dataset(data)

    # 维度
    campaign = Dimension("Campaign", role=FieldRole.ROW)
    device = Dimension("Device", role=FieldRole.COLUMN)
    month = Dimension("Date", role=FieldRole.COLUMN, time_grain="month")

    # 指标
    single_profit = RowMeasure("single_profit", (col("revenue") - col("cost")), agg="sum")
    clicks = AggMeasure("Clicks", Sum("clicks"))
    impr = AggMeasure("Impressions", Sum("impr"))
    ctr = AggMeasure("CTR", RatioOfSums("clicks", "impr", 0))
    cpc = AggMeasure("CPC", RatioOfSums("cost", "clicks", 0))

    # WHERE：两种写法
    where_py = (col("Country").isin(["US", "CA"]) & (col("impr") > 0) & ~(col("Device") == "Tablet"))
    where_sql = sql_bigquery("WHERE `Country` IN ('US','CA') AND `impr` > 0 AND NOT (`Device` = 'Tablet')")

    # HAVING：建议用指标别名
    having = sql_duckdb("HAVING CTR >= 0.15 AND Clicks >= 100")

    spec = ReportSpec(
        rows=[campaign],
        columns=[device],
        slicers=[month],
        metrics=[clicks, impr, ctr, cpc, single_profit],
        where=where_sql,
        having=having,
        sort_by=[SortBy("CTR", ascending=False), SortBy("Clicks", ascending=False)],
        topn=10,
        totals=True
    )

    print("=== PandasEngine ===")
    result = dataset.report(spec)  # Pandas
    for k, frame in result.frames.items():
        print(f"\n--- Slice: {k} ---")
        print(frame)

    # DuckDB（可选）
    # print("\n=== DuckDBEngine ===")
    # result2 = dataset.report(spec, engine=DuckDBEngine())
    # for k, frame in result2.frames.items():
    #     print(f"\n--- Slice: {k} ---")
    #     print(frame)

    # BigQuery（示例：请先在 GCP 中准备表，并配置好凭据）
    # bq = BigQueryEngine(project="YOUR_PROJECT", dataset="YOUR_DATASET", table="YOUR_TABLE")
    # bq_result = dataset.report(spec, engine=bq)
    # for k, frame in bq_result.frames.items():
    #     print(f"\n--- BQ Slice: {k} ---")
    #     print(frame)

    # --- ReportSpec JSON 序列化/反序列化示例 ---
    spec_json = spec.to_dict()
    print("\nSerialized ReportSpec:", json.dumps(spec_json, ensure_ascii=False)[:200], "...")
    spec2 = ReportSpec.from_dict(spec_json)
    assert json.dumps(spec2.to_dict(), sort_keys=True) == json.dumps(spec_json, sort_keys=True)
    print("ReportSpec (de)serialization OK.")
