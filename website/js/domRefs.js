/* =========================================================================
   domRefs.js -- every element on dashboard.html this page ever touches,
   looked up once.

   Its own module because it is the one part of the dashboard that is neither
   wiring nor data: it is the contract with the MARKUP. Having it in one place
   means a renamed id shows up here, next to every other id, rather than
   halfway down an orchestrator -- and it keeps dashboard.js opening with what
   the page DOES rather than forty-odd getElementById calls.

   Read at module load, like before. Every id here exists in dashboard.html at
   parse time (the script is a module, so it runs after the document is
   parsed); an id that does not simply yields null, exactly as it did when
   this lived in dashboard.js.
   ========================================================================= */

export const els = {
  notConfigured: document.getElementById('dashNotConfigured'),
  loading: document.getElementById('dashLoading'),
  error: document.getElementById('dashError'),
  errorMsg: document.getElementById('dashErrorMsg'),
  content: document.getElementById('dashContent'),
  summaryTotal: document.getElementById('dashSummaryTotal'),
  summarySub: document.getElementById('dashSummarySub'),
  miniRow: document.getElementById('dashMiniRow'),
  emptyHint: document.getElementById('dashEmptyHint'),
  factsCard: document.getElementById('dashFactsCard'),
  facts: document.getElementById('dashFacts'),
  trend: document.getElementById('dashTrend'),
  breakdown: document.getElementById('dashBreakdown'),
  sessionsBody: document.getElementById('dashSessionsBody'),
  signOutBtn: document.getElementById('signOutBtn'),
  calPrev: document.getElementById('dashCalPrev'),
  calNext: document.getElementById('dashCalNext'),
  calMonthLabel: document.getElementById('dashCalMonthLabel'),
  calGrid: document.getElementById('dashCalGrid'),
  calDayTitle: document.getElementById('dashCalDayTitle'),
  calDayList: document.getElementById('dashCalDayList'),
  planAdd: document.getElementById('dashPlanAdd'),
  planList: document.getElementById('dashPlanList'),
  planFormSlot: document.getElementById('dashPlanFormSlot'),
  planMsg: document.getElementById('dashPlanMsg'),
  webPushRow: document.getElementById('dashWebPushRow'),
  webPushBtn: document.getElementById('dashWebPushBtn'),
  webPushStatus: document.getElementById('dashWebPushStatus'),
  writeError: document.getElementById('dashWriteError'),
  labelsMsg: document.getElementById('dashLabelsMsg'),
  labelsList: document.getElementById('dashLabelsList'),
  labelAddForm: document.getElementById('dashLabelAddForm'),
  labelAddSwatches: document.getElementById('dashLabelAddSwatches'),
  labelAddName: document.getElementById('dashLabelAddName'),
  labelAddSubmit: document.getElementById('dashLabelAddSubmit'),
  labelsCapMsg: document.getElementById('dashLabelsCapMsg'),
  goalsMsg: document.getElementById('dashGoalsMsg'),
  goalsList: document.getElementById('dashGoalsList'),
  goalFormSlot: document.getElementById('dashGoalFormSlot'),
  goalsCapMsg: document.getElementById('dashGoalsCapMsg'),
  accountMsg: document.getElementById('dashAccountMsg'),
  accountBody: document.getElementById('dashAccountBody'),
};
