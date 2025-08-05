from __future__ import annotations
from enum import Enum
from abc import ABC, abstractmethod
from typing import Any, List, Set, Optional, Union
import pandas as pd
import numpy as np

class FieldRole(Enum):
    ROW = "row"
    COLUMN = "column"


class Expr:
    def __init__(self, *express: Union[str, 'Expr']):
        self.exprs: List['Expr'] = [self.resolve(e) for e in express]
        if len(self.exprs) == 1:
            self.expr = self.exprs[0]

    @staticmethod
    def resolve(e: Union[str, 'Expr']) -> 'Expr':
        return Field.Ref(e) if isinstance(e, str) else e

    def eval(self, df: pd.DataFrame) -> pd.Series:
        raise NotImplementedError

    def dependencies(self) -> Set[str]:
        return set().union(*(e.dependencies() for e in self.exprs))

    def __str__(self) -> str:
        return f"{self.__class__.__name__}({', '.join(str(e) for e in self.exprs)})"



class Field:
    def __init__(self, name: str, role: FieldRole = FieldRole.COLUMN):
        self.name = name
        self.role = role

    def __repr__(self):
        return f"<Field name={self.name}, role={self.role}>"

    def ref(self) -> Ref:
        return self.Ref(self.name)

    class Ref(Expr):
        def __init__(self, name: str):
            super().__init__()
            self.name = name

        def eval(self, df: pd.DataFrame) -> pd.Series:
            return df[self.name]

        def dependencies(self) -> Set[str]:
            return {self.name}

        def __str__(self):
            return self.name

class Metric:
    def __init__(self, expr: Expr):
        self.expr = expr

    def eval(self, df: pd.DataFrame) -> pd.Series:
        return self.expr.eval(df)

    def dependencies(self):
        return self.expr.dependencies()


class MetricField(Field, Metric):
    def __init__(self, name: str, expr: Expr, role: FieldRole = FieldRole.COLUMN):
        Field.__init__(self, name, role)
        Metric.__init__(self, expr)


# --- Filters ---
class Filter(ABC):
    def __init__(self, field: Field):
        self.field = field

    @abstractmethod
    def apply(self, df: pd.DataFrame) -> pd.Series:
        pass


class EqualFilter(Filter):
    def __init__(self, field: Field, value: Any):
        super().__init__(field)
        self.value = value

    def apply(self, df: pd.DataFrame) -> pd.Series:
        return df[self.field.name] == self.value


class IncludeFilter(Filter):
    def __init__(self, field: Field, values: List[Any]):
        super().__init__(field)
        self.values = values

    def apply(self, df: pd.DataFrame) -> pd.Series:
        return df[self.field.name].isin(self.values)


# --- DataTable ---
class DataTable:
    def __init__(self, df: pd.DataFrame):
        self.df = df
        self.fields: List[Field] = []
        self.filters: List[Filter] = []

    def add_field(self, field: Field):
        self.fields.append(field)

    def add_filter(self, filter_: Filter):
        self.filters.append(filter_)

    def apply_filters(self) -> pd.DataFrame:
        df = self.df.copy()
        for f in self.filters:
            df = df[f.apply(df)]
        return df

    # 在 DataTable 类中加入此方法
    def transform(self, *fields: Union[Field, MetricField]) -> 'DataTable':
        """
        根据给定的字段（Field 或 MetricField）计算并生成一个新的 DataTable 实例。
        支持字段结构信息（Field）和可计算字段（MetricField）的组合。

        参数：
            fields: 可变参数形式的字段对象（Field 或 MetricField）

        返回：
            DataTable：新的数据表，仅包含所提供字段的结果
        """
        df_source = self.apply_filters()
        df_transformed = pd.DataFrame()

        for field in fields:
            if isinstance(field, MetricField):
                df_transformed[field.name] = field.eval(df_source)
            elif isinstance(field, Field):
                if field.name not in df_source.columns:
                    raise ValueError(f"Field '{field.name}' not found in DataFrame columns.")
                df_transformed[field.name] = df_source[field.name]
            else:
                raise TypeError(f"transform() only accepts Field or MetricField, got {type(field)}")

        return DataTable(df_transformed)

    def evaluate(self) -> pd.DataFrame:
        df = self.apply_filters()
        results = pd.DataFrame()
        for field in self.fields:
            if isinstance(field, MetricField):
                results[field.name] = field.eval(df)
            else:
                results[field.name] = df[field.name]
        return results


class FillZeroMeanExpr(Expr):
    def __init__(self, expr: Union[str, Expr], groupby: Optional[List[str]] = None):
        super().__init__(expr)
        self.groupby = groupby or []

    def eval(self, df: pd.DataFrame) -> pd.Series:
        values = self.expr.eval(df)
        grouped = df.groupby(self.groupby)[values.name] if self.groupby else values
        means = grouped.transform(lambda x: x.replace(0, np.nan).fillna(x.mean()))
        return means


class MeanExpr(Expr):
    def __init__(self, expr: Union[str, Expr], groupby: Optional[List[str]] = None):
        super().__init__(expr)
        self.groupby = groupby or []

    def eval(self, df: pd.DataFrame) -> pd.Series:
        values = self.expr.eval(df)
        return df.groupby(self.groupby)[values.name].transform("mean") if self.groupby else pd.Series(
            [values.mean()] * len(df))


class StdExpr(Expr):
    def __init__(self, expr: Union[str, Expr], groupby: Optional[List[str]] = None):
        super().__init__(expr)
        self.groupby = groupby or []

    def eval(self, df: pd.DataFrame) -> pd.Series:
        values = self.expr.eval(df)
        return df.groupby(self.groupby)[values.name].transform("std") if self.groupby else pd.Series(
            [values.std()] * len(df))


class GrowthRateExpr(Expr):
    def __init__(self, expr: Union[str, Expr], groupby: Optional[List[str]] = None):
        super().__init__(expr)
        self.groupby = groupby or []

    def eval(self, df: pd.DataFrame) -> pd.Series:
        values = self.expr.eval(df)

        def compute_growth(group):
            y = group[values.name].values
            x = np.arange(len(y))
            if len(y) < 2 or np.mean(y) == 0:
                return pd.Series([0.0] * len(group), index=group.index)
            slope, _ = np.polyfit(x, y, 1)
            rate = (slope / np.mean(y)) * 100
            return pd.Series([rate] * len(group), index=group.index)
        return df.groupby(self.groupby).apply(compute_growth).reset_index(level=self.groupby, drop=True) if self.groupby else compute_growth(df)



class ScoreExpr(Expr):
    def __init__(self, expr: Union[str, Expr], groupby: Optional[List[str]] = None):
        super().__init__(expr)
        self.groupby = groupby or []

    def eval(self, df: pd.DataFrame) -> pd.Series:
        values = self.expr.eval(df)
        grouped = df.groupby(self.groupby)[values.name] if self.groupby else pd.Series(values)

        def compute_score(series):
            min_v = series.min()
            max_v = series.max()
            if max_v > min_v:
                return ((series - min_v) / (max_v - min_v)) * 9 + 1
            else:
                return pd.Series([1.0] * len(series), index=series.index)

        return grouped.transform(compute_score) if self.groupby else compute_score(values)


class GoogleTrendAnalysis:
    def __init__(self, df: pd.DataFrame, keyword: str):
        self.df = df
        self.keyword = keyword

    def build(self) -> DataTable:
        # 定义字段
        month_field = Field("Month_Num", FieldRole.ROW)
        keyword_field = Field("Keyword", FieldRole.COLUMN)

        # 创建 DataTable 并加上过滤器
        table = DataTable(self.df)
        table.add_filter(EqualFilter(keyword_field, self.keyword))

        # 定义指标
        filled_expr = FillZeroMeanExpr("Interest", groupby=["Month_Num"])
        filled_field = MetricField("Filled_Interest", filled_expr)

        mean_expr = MeanExpr(filled_field.name, groupby=["Month_Num"])
        std_expr = StdExpr(filled_field.name, groupby=["Month_Num"])
        growth_expr = GrowthRateExpr(filled_field.name, groupby=["Month_Num"])
        score_expr = ScoreExpr(filled_field.name, groupby=["Month_Num"])

        mean_field = MetricField("回补后月均值", mean_expr)
        std_field = MetricField("标准差", std_expr)
        growth_field = MetricField("增长率（%）", growth_expr)
        score_field = MetricField("真实旺季评分", score_expr)

        # 构建分析 DataTable
        result_table = table.transform(month_field, mean_field, std_field, growth_field, score_field)
        return result_table


df = pd.read_csv("location_report.csv", header=1)
# 设置显示所有行和列
pd.set_option('display.max_rows', None)    # 显示所有行
pd.set_option('display.max_columns', None) # 显示所有列
pd.set_option('display.width', 0)          # 自动调整宽度
pd.set_option('display.max_colwidth', None) # 显示完整列内容（防止被截断）
print(df)
