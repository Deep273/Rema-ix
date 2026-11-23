"use strict";

async function createCatalogWorkbook(rows, filterRows) {
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const documentRelationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const packageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";
  const contentTypes = "http://schemas.openxmlformats.org/package/2006/content-types";
  const clean = value => String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const sheetRows = values => values.map((row, index) => '<row r="' + (index + 1) + '">' + row.map(value => {
    if (value == null) return "<c/>";
    if (typeof value === "number" && Number.isFinite(value)) return "<c><v>" + value + "</v></c>";
    return '<c t="inlineStr"><is><t xml:space="preserve">' + clean(value) + '</t></is></c>';
  }).join("") + "</row>").join("");

  const zip = new JSZip();
  zip.file("[Content_Types].xml", xml + '<Types xmlns="' + contentTypes + '">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>');
  zip.file("_rels/.rels", xml + '<Relationships xmlns="' + packageRelationships + '">' +
    '<Relationship Id="rId1" Type="' + documentRelationships + '/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file("xl/workbook.xml", xml + '<workbook xmlns="' + spreadsheet + '" xmlns:r="' + documentRelationships + '">' +
    '<sheets><sheet name="Объявления" sheetId="1" r:id="rId1"/><sheet name="Фильтры" sheetId="2" r:id="rId2"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", xml + '<Relationships xmlns="' + packageRelationships + '">' +
    '<Relationship Id="rId1" Type="' + documentRelationships + '/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="' + documentRelationships + '/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  const widthsFor = values => {
    const limits = {
      "Название": 30, "Сделка": 12, "Регион": 19,
      "Район / округ": 18, "Населённый пункт": 20,
      "Улица": 22, "Дом": 8, "Этаж / этажность": 16,
      "Отделка": 22, "Источник": 14, "Дата публикации": 16,
      "Ссылка на объявление": 24
    };
    return (values[0] || []).map((heading, column) => {
      const limit = limits[heading] || 18;
      const longest = values.reduce((length, row) =>
        Math.max(length, ...String(row[column] ?? "").split(/\r\n|\r|\n/).map(line => line.length)), 0);
      return Math.min(limit, Math.max(9, longest + 2));
    });
  };
  const worksheet = values => {
    const widths = widthsFor(values);
    const columns = widths.map((width, index) =>
      '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>'
    ).join("");

    const rows = values.map((row, index) => {
      const lines = Math.max(1, ...row.map((value, column) =>
        String(value ?? "").split(/\r\n|\r|\n/).reduce((total, line) => {
          const capacity = Math.max(1, Math.floor((widths[column] - 2) / 1.15));
          return total + Math.max(1, Math.ceil(line.length / capacity));
        }, 0)
      ));
      const height = Math.min(409, Math.max(22, 15 * lines + 6));
      return sheetRows([row])
        .replace('<row r="1">', '<row r="' + (index + 1) + '" ht="' + height + '" customHeight="1">')
        .replace(/<c(?=[ />])/g, '<c s="' + (index === 0 ? 2 : 1) + '"');
    }).join("");

    return xml + '<worksheet xmlns="' + spreadsheet + '">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + columns + '</cols><sheetData>' + rows + '</sheetData></worksheet>';
  };

  zip.file("xl/styles.xml", xml + '<styleSheet xmlns="' + spreadsheet + '">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF174CC6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');

  zip.file("xl/worksheets/sheet1.xml", worksheet(rows));
  zip.file("xl/worksheets/sheet2.xml", worksheet(filterRows));

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}
