import { DesignTaskLog } from '../../types/tasks';
export interface ReviewDraft {
 editQuote: string; selectedAudiences: string[]; selectedAvoidColor: string;
 selectedBgMode: string; selectedMaxColors: number; editablePrompt: string;
 editNiche1: string; editNiche2: string; editSubniche: string; editKeywords: string;
 editableListing: {brand: string; title: string; bullet1: string; bullet2: string; description: string};
 liveTmResult: any; isCheckingTm: boolean; editedSvgData: string; revectorizeMaxColors: number;
}
  // Helper to extract listing fields safely from all sources
  const extractListingFields = (task?: DesignTaskLog) => {
    if (!task) return { brand: '', title: '', bullet1: '', bullet2: '', description: '' };

    let lr: any = task.listingResult;
    if (typeof lr === 'string') {
      try {
        let clean = lr.trim();
        if (clean.startsWith('```')) clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        lr = JSON.parse(clean);
      } catch {}
    }

    const en = (lr && typeof lr === 'object') ? (lr.en || lr) : {};
    const refined = task.trademarkRefineResult?.refined_listing || {};

    let brand = refined.brand || en.brand || en.brandName || '';
    let title = refined.title || en.title || en.designTitle || '';
    let bullet1 = refined.bullet1 || en.bullet1 || en.bullet_1 || en.featureBullet1 || en.feature_bullet1 || '';
    let bullet2 = refined.bullet2 || en.bullet2 || en.bullet_2 || en.featureBullet2 || en.feature_bullet2 || '';
    let description = refined.description || en.description || en.product_description || en.productDescription || en.desc || '';

    // Fallback scan across task events
    if ((!description || !title) && Array.isArray(task.events)) {
      for (let i = task.events.length - 1; i >= 0; i--) {
        const ev = task.events[i];
        if (ev.type === 'TM_REFINE_RESPONSE' && ev.content?.refined_listing) {
          brand = brand || ev.content.refined_listing.brand || '';
          title = title || ev.content.refined_listing.title || '';
          bullet1 = bullet1 || ev.content.refined_listing.bullet1 || '';
          bullet2 = bullet2 || ev.content.refined_listing.bullet2 || '';
          description = description || ev.content.refined_listing.description || '';
        }
        if (ev.type === 'LISTING_RESPONSE' && ev.content) {
          const listObj = ev.content.en || ev.content;
          if (typeof listObj === 'object' && listObj !== null) {
            brand = brand || listObj.brand || '';
            title = title || listObj.title || '';
            bullet1 = bullet1 || listObj.bullet1 || '';
            bullet2 = bullet2 || listObj.bullet2 || '';
            description = description || listObj.description || listObj.product_description || '';
          }
        }
      }
    }

    return { brand, title, bullet1, bullet2, description };
  };


export function createReviewDraft(activeTask: DesignTaskLog) {
  const draft = {} as ReviewDraft;
      // Pre-Flight Quote
      draft.editQuote = (activeTask.payload?.quote || activeTask.payload?.quote_or_phrase || activeTask.payload?.text || '');

      // Design Review fields
      const pred = activeTask.analysisResult;
      
      // 2. Audience multi-selection (Men, Women, Youth) - Case Insensitive Normalization
      let rawAudList: string[] = [];
      if (activeTask.customAnswers?.audience && activeTask.customAnswers.audience !== 'Standard') {
        rawAudList = Array.isArray(activeTask.customAnswers.audience)
          ? activeTask.customAnswers.audience
          : String(activeTask.customAnswers.audience).split(',');
      } else if (pred?.target_group?.selected) {
        rawAudList = Array.isArray(pred.target_group.selected)
          ? pred.target_group.selected
          : String(pred.target_group.selected).split(',');
      } else if (pred?.fitTypes && pred.fitTypes !== 'Standard') {
        rawAudList = Array.isArray(pred.fitTypes)
          ? pred.fitTypes
          : String(pred.fitTypes).split(',');
      }

      const normalizeAudienceName = (raw: string) => {
        const low = raw.trim().toLowerCase();
        if (low === 'men' || low === 'männer' || low === 'herren') return 'Men';
        if (low === 'women' || low === 'frauen' || low === 'damen') return 'Women';
        if (low === 'youth' || low === 'kinder' || low === 'kids' || low === 'jugend') return 'Youth';
        return null;
      };

      const audiences = rawAudList.map(s => normalizeAudienceName(s)).filter((s): s is NonNullable<typeof s> => s !== null);
      draft.selectedAudiences = (audiences.length > 0 ? Array.from(new Set(audiences)) : ['Men', 'Women', 'Youth']);

      // 3. Avoid Color (Black, White, None)
      const rawAvoid = (activeTask.customAnswers?.avoidColor || pred?.avoidColor || pred?.avoid_product_colors?.avoid || 'None').trim();
      let normAvoid = 'None';
      if (rawAvoid.toLowerCase().includes('black') || rawAvoid.toLowerCase().includes('schwarz')) {
        normAvoid = 'Black';
      } else if (rawAvoid.toLowerCase().includes('white') || rawAvoid.toLowerCase().includes('weiß')) {
        normAvoid = 'White';
      } else {
        normAvoid = 'None';
      }
      draft.selectedAvoidColor = (normAvoid);

      // 4. Background removal mode (Automatisch / Manuell)
      const isManual = activeTask.customAnswers?.reuseBackground === 'Manuell' || activeTask.customAnswers?.reuseBackground === 'MANUAL' || activeTask.customAnswers?.reuseBackground === 'Ja (Hintergrund behalten)' || pred?.background_analysis?.removal_mode === 'MANUAL' || pred?.background_analysis?.is_design_element === true;
      draft.selectedBgMode = (isManual ? 'Manuell' : 'Automatisch');

      draft.selectedMaxColors = (activeTask.customAnswers?.maxColors ?? pred?.color_analysis?.color_count ?? 2);
      draft.editablePrompt = (activeTask.resultPrompt || activeTask.payload?.quote || '');

      // Niche Hierarchy & Keywords: Prioritize AI Vision QA findings so user sees AI prediction!
      const aiN1 = activeTask.analysisResult?.niche_analysis?.niche1 || activeTask.analysisResult?.niche1 || '';
      const aiN2 = activeTask.analysisResult?.niche_analysis?.niche2 || activeTask.analysisResult?.niche2 || '';
      const aiSub = activeTask.analysisResult?.niche_analysis?.subniche || activeTask.analysisResult?.subniche || '';

      const n1 = activeTask.niche1 || activeTask.customAnswers?.niche1 || aiN1 || activeTask.payload?.niche1 || '';
      const n2 = activeTask.niche2 || activeTask.customAnswers?.niche2 || aiN2 || activeTask.payload?.niche2 || '';
      const sub = activeTask.subniche || activeTask.customAnswers?.subniche || aiSub || activeTask.payload?.subniche || '';
      const kw = activeTask.keywords || activeTask.customAnswers?.keywords || activeTask.payload?.keywords || activeTask.payload?.hermesKeywords || [];

      draft.editNiche1 = (n1);
      draft.editNiche2 = (n2 && n2.toLowerCase() !== 'none' ? n2 : '');
      draft.editSubniche = (sub && sub.toLowerCase() !== 'none' ? sub : '');
      draft.editKeywords = (Array.isArray(kw) ? kw.join(', ') : String(kw || ''));

      // TM Review Listing fields
      const fields = extractListingFields(activeTask);
      draft.editableListing = (fields);
      draft.liveTmResult = (activeTask.trademarkCheckResult || null);

      // SVG Review fields
      draft.editedSvgData = (activeTask.svgContent || '');
      draft.revectorizeMaxColors = (activeTask.customAnswers?.maxColors ?? activeTask.analysisResult?.color_analysis?.color_count ?? 2);
  draft.isCheckingTm = false;
  return draft;
}
