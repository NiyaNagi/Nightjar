# Future Features Roadmap

This document tracks planned features that require significant implementation effort or depend on upstream library support.

---

## 📊 Spreadsheet Charts

**Status:** ⏳ Waiting on upstream (Fortune Sheet)  
**Priority:** Medium  
**Effort:** High (if implementing ourselves)

### Description
Add support for creating charts (bar, line, pie, scatter, etc.) from spreadsheet data, similar to Excel and Google Sheets.

### Current Situation
- Fortune Sheet (our spreadsheet library) does NOT currently support charts
- Listed on their roadmap but no implementation date
- See: https://github.com/ruilisi/fortune-sheet#roadmap

### Options

| Approach | Pros | Cons |
|----------|------|------|
| **Wait for Fortune Sheet** | Native integration, minimal work | Unknown timeline, may never happen |
| **Chart.js integration** | Mature library, easy to use | Separate component, not embedded in cells |
| **Recharts integration** | React-native, good for dashboards | Same as above |
| **ECharts integration** | Powerful, Chinese docs | Complex, large bundle |

### Implementation Notes (if doing ourselves)
1. Add "Insert Chart" button to toolbar or context menu
2. User selects data range
3. Open chart configuration modal (type, labels, colors)
4. Render chart in a floating overlay or dedicated panel
5. Store chart config in Yjs document for sync
6. Consider: Can charts be embedded in cells? Or separate panel?

### Dependencies
- Chart library (Chart.js, Recharts, or ECharts)
- UI for chart configuration
- Yjs schema for chart data

---

## 📋 Pivot Tables

**Status:** ⏳ Waiting on upstream (Fortune Sheet)  
**Priority:** Low  
**Effort:** Very High (if implementing ourselves)

### Description
Add pivot table functionality to summarize, analyze, explore, and present data.

### Current Situation
- Fortune Sheet does NOT support pivot tables
- Listed on their roadmap but no implementation
- Complex feature that requires significant development

### Options

| Approach | Pros | Cons |
|----------|------|------|
| **Wait for Fortune Sheet** | Native integration | Unknown timeline |
| **react-pivottable** | Ready-made solution | Separate UI, may not integrate well |
| **Custom implementation** | Full control | Massive development effort |

### Implementation Notes (if doing ourselves)
1. Would need a completely new component
2. Drag-and-drop field configuration
3. Aggregation functions (sum, count, average, etc.)
4. Grouping by row/column fields
5. Filtering and sorting
6. Real-time sync via Yjs

### Dependencies
- Fortune Sheet pivot table support, OR
- Standalone pivot table library
- Significant UI work

---

## 📥 Excel Import/Export

**Status:** 🔬 Research needed  
**Priority:** Medium  
**Effort:** Medium

### Description
Import .xlsx files into Nightjar spreadsheets and export spreadsheets as .xlsx files.

### Current Situation
- Fortune Sheet has a community plugin: [fortuneexcel](https://github.com/corbe30/fortuneexcel)
- May work with our version, needs testing

### Implementation Notes
1. Install fortuneexcel plugin
2. Add "Import Excel" button
3. Add "Export to Excel" option
4. Test with various .xlsx files
5. Handle edge cases (formulas, formatting, images)

### Dependencies
- fortuneexcel or SheetJS
- File picker integration
- Error handling for unsupported features

---

## 📈 Progress Tracking

| Feature | Status | Target Version |
|---------|--------|----------------|
| Charts | ⏳ Waiting | TBD |
| Pivot Tables | ⏳ Waiting | TBD |
| Excel Import/Export | 🔬 Research | v1.4.0? |

---

*Last updated: 2026-02-06*
