"""Conservative project reconciliation and explicitly labeled description hints."""
import re
import pandas as pd


def reconcile_support_permits(frame):
    frame = frame.copy()
    for column in ('PermitNum', 'StatusCurrent', 'RelatedMup', 'Development Site', 'HousingCategory', 'Zoning'):
        if column not in frame:
            frame[column] = None
    frame['SourcePermitNumbers'] = frame.PermitNum.fillna('Unknown').astype(str)
    frame['ReconciliationNote'] = ''
    frame['SupportingPermitValue'] = 0.0
    frame['ReportedUnitsAdded'] = frame.HousingUnitsAdded
    primary = frame.ParentPermitNum.isna()
    description = frame.Description.fillna('')
    support = description.str.contains(r'^\s*(?:construct\s+)?(?:shoring|excavation)|^\s*construct\s+.*shoring and excavation', case=False, regex=True)
    # Only reconcile housing-bearing support work when exactly one housing
    # building permit shares both the address and an explicit source identifier.
    drops = []
    for index, row in frame.loc[primary & support & frame.HousingUnitsAdded.gt(0)].iterrows():
        address = str(row.OriginalAddress1).strip().upper()
        same_address = frame.OriginalAddress1.fillna('').str.strip().str.upper().eq(address)
        linked = pd.Series(False, index=frame.index)
        for key in ('RelatedMup', 'Development Site'):
            if pd.notna(row[key]) and str(row[key]).strip():
                linked |= frame[key].eq(row[key])
        candidates = frame.loc[primary & ~support & frame.PermitTypeDesc.eq('New') & frame.HousingUnitsAdded.gt(0) & linked & same_address]
        if len(candidates) != 1:
            continue
        target = candidates.index[0]
        frame.at[target, 'SourcePermitNumbers'] += ' / ' + str(row.PermitNum)
        frame.at[target, 'SupportingPermitValue'] += float(row.EstProjectCostNumeric or 0) if pd.notna(row.EstProjectCostNumeric) else 0
        frame.at[target, 'ReconciliationNote'] += (
            f"Linked support permit {row.PermitNum} reported {row.HousingUnitsAdded:g} units; "
            f"housing and value use building permit {frame.at[target, 'PermitNum']} "
            f"({frame.at[target, 'HousingUnitsAdded']:g} units). Support valuation is listed separately, not added. "
        )
        drops.append(index)
    return frame.drop(index=drops)


def joined(values):
    return ' / '.join(sorted({str(v).strip() for v in values if pd.notna(v) and str(v).strip()})) or 'Unknown'


def use_hint(description):
    text = str(description).lower()
    housing = bool(re.search(r'residen|apartment|dwelling|housing|townhouse', text))
    commercial = bool(re.search(r'retail|commercial|office', text))
    if re.search(r'mixed[ -]?use', text) or (housing and commercial):
        return 'Mixed-use indicated'
    if re.search(r'hospital|medical|school|university|laborator', text):
        return 'Institutional use indicated'
    if housing:
        return 'Housing indicated; other uses unknown'
    return 'Use not established'
