import { expect, it } from 'vitest';
import { interpretBoolean } from '@lib/fill/interpretAnswer';
it.each([
  ['Will you require sponsorship?',true,true],
  ['Will you require sponsorship in Canada?',true,null],
  ['Will you require sponsorship in the UK?',false,null],
  ['Will you require sponsorship in New Zealand?',true,null],
  ['Will you need visa sponsorship in the United States?',true,true],
  ['Can you work without sponsorship?',true,false],
  ['Can you work without sponsorship?',false,true],
  ['Are you authorized to work and do you require sponsorship?',true,null],
  ['Our company cannot provide sponsorship',true,null],
  ['If you require sponsorship, have you filed a visa application?',true,null],
  ['Will you require sponsorship or relocation assistance?',true,null],
  ['Will you now or in the future require sponsorship?',true,true],
  ['Are you willing to pay sponsorship fees?',true,null],
] as const)('interprets sponsorship: %s',(label,fact,answer)=>expect(interpretBoolean('auth.needsSponsorship',label,fact)).toBe(answer));
it.each([
  ['Are you authorized to work in the United States?',true],
  ['Are you authorized to work in Canada?',null],
  ['Are you authorized to work in the United Kingdom?',null],
  ['Are you a US citizen or authorized to work?',null],
  ['Are you not authorized to work?',null],
  ['',null],
] as const)('limits authorization to supported questions: %s',(label,answer)=>expect(interpretBoolean('auth.workAuthorized',label,true)).toBe(answer));
