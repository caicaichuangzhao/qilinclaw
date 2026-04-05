import * as cheerio from 'cheerio';

export interface ElementFingerprint {
  tagName: string;
  id?: string;
  classes: string[];
  textDensity: number;
  textLength: number;
  parentPath: string[];      // e.g. ['DIV', 'BODY', 'HTML']
  siblingTags: string[];     // e.g. ['H1', 'P', 'DIV']
  attributes: Record<string, string>;
  innerTextFirst30Chars: string;
}

export class DOMFingerprintEngine {
  
  /**
   * 生成某个 DOM 节点的特征指纹
   */
  public generateFingerprint($: cheerio.CheerioAPI, element: any): ElementFingerprint | null {
    if (element.type !== 'tag') return null;
    
    const $el = $(element);
    const tagName = element.tagName.toUpperCase();
    const id = $el.attr('id');
    const classStr = $el.attr('class') || '';
    const classes = classStr.split(/\s+/).filter(c => c.length > 0).sort();
    
    const text = $el.text().trim();
    const htmlLength = $el.html()?.length || 1;
    const textDensity = text.length / htmlLength;
    
    const parentPath = $el.parents().map((i, el) => {
        if (el.type === 'tag') return el.tagName.toUpperCase();
        return '';
    }).get().filter(t => t.length > 0);

    const siblingTags = $el.siblings().map((i, el) => {
        if (el.type === 'tag') return el.tagName.toUpperCase();
        return '';
    }).get().filter(t => t.length > 0);

    const attributes: Record<string, string> = {};
    if (element.attribs) {
      for (const [key, value] of Object.entries(element.attribs)) {
        if (key !== 'class' && key !== 'id') {
          attributes[key] = String(value).substring(0, 100); // Limit length
        }
      }
    }

    return {
      tagName,
      id,
      classes,
      textDensity,
      textLength: text.length,
      parentPath,
      siblingTags,
      attributes,
      innerTextFirst30Chars: text.substring(0, 30)
    };
  }

  /**
   * 计算节点与指纹的相似度评分 (0-1)
   */
  public calculateSimilarity(target: ElementFingerprint, candidate: ElementFingerprint): number {
    let score = 0;
    let maxWeight = 0;

    // 1. Tag Match (Weight: 20)
    maxWeight += 20;
    if (target.tagName === candidate.tagName) score += 20;

    // 2. ID Match (Weight: 15)
    if (target.id) {
        maxWeight += 15;
        if (candidate.id === target.id) score += 15;
    }

    // 3. Class Overlap (Weight: 20)
    if (target.classes.length > 0) {
        maxWeight += 20;
        const intersection = target.classes.filter(c => candidate.classes.includes(c));
        const overlapRatio = intersection.length / Math.max(target.classes.length, 1);
        score += (overlapRatio * 20);
    }

    // 4. Parent Path Match (Weight: 15)
    maxWeight += 15;
    let pathMatches = 0;
    const checkLen = Math.min(target.parentPath.length, candidate.parentPath.length, 3); // Check up to 3 parents
    for (let i = 0; i < checkLen; i++) {
        if (target.parentPath[i] === candidate.parentPath[i]) pathMatches++;
    }
    if (checkLen > 0) {
        score += (pathMatches / checkLen) * 15;
    } else if (target.parentPath.length === 0 && candidate.parentPath.length === 0) {
        score += 15; // Both are root
    }

    // 5. Structure / Density Similarity (Weight: 10)
    maxWeight += 10;
    const densityDiff = Math.abs(target.textDensity - candidate.textDensity);
    score += Math.max(0, 10 - (densityDiff * 10));

    // 6. Same semantic attributes e.g. placeholder, name, type, href (Weight: 20)
    const importantAttrs = ['href', 'src', 'name', 'type', 'placeholder', 'aria-label', 'title', 'data-testid'];
    let attrWeight = 0;
    let attrScore = 0;
    for (const attr of importantAttrs) {
        if (target.attributes[attr]) {
            attrWeight += 5;
            if (candidate.attributes[attr] === target.attributes[attr]) {
                attrScore += 5;
            } else {
                // partial match e.g. partial URL
                if (candidate.attributes[attr] && (candidate.attributes[attr].includes(target.attributes[attr]) || target.attributes[attr].includes(candidate.attributes[attr]))) {
                    attrScore += 2;
                }
            }
        }
    }
    if (attrWeight > 0) {
        maxWeight += 20;
        score += (attrScore / attrWeight) * 20;
    }

    // Normalize
    return maxWeight > 0 ? score / maxWeight : 0;
  }

  /**
   * 在整个文档中基于指纹寻找最佳匹配节点
   */
  public findBestMatch(html: string, targetFingerprint: ElementFingerprint): { element: any | null, score: number, cheerioContext: cheerio.CheerioAPI } {
    const $ = cheerio.load(html);
    let bestMatch: any | null = null;
    let highestScore = 0;

    // Filter to same tags to reduce computation
    const candidates = $(targetFingerprint.tagName.toLowerCase()).toArray();

    for (const node of candidates) {
        const candidateFingerprint = this.generateFingerprint($, node);
        if (!candidateFingerprint) continue;

        const score = this.calculateSimilarity(targetFingerprint, candidateFingerprint);
        if (score > highestScore) {
            highestScore = score;
            bestMatch = node;
        }

        // Exact match short-circuit
        if (score > 0.98) break;
    }

    return { element: bestMatch, score: highestScore, cheerioContext: $ };
  }
}

export const fingerprintEngine = new DOMFingerprintEngine();
