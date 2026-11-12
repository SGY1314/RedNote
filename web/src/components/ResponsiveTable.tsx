import { Table } from "antd";
import type { TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMediaQuery } from "../hooks/useMediaQuery";

/** One data source and the same actions, shown as labelled records on phones. */
export default function ResponsiveTable<T extends object>(props: TableProps<T>) {
  const narrow = useMediaQuery("(max-width: 700px)");
  const decorate = (columns: ColumnsType<T>): ColumnsType<T> => columns.map((column) => {
    if ("children" in column) return { ...column, children: decorate(column.children) };
    return {
      ...column,
      fixed: narrow ? undefined : column.fixed,
      onCell: (record, index) => ({
        ...column.onCell?.(record, index),
        "data-field-label": typeof column.title === "string" ? column.title : "",
      }),
    };
  });
  return <Table<T>
    {...props}
    className={`responsive-record-table ${props.className || ""}`}
    columns={decorate(props.columns || [])}
    scroll={narrow ? undefined : props.scroll}
    showHeader={narrow ? false : props.showHeader}
  />;
}
