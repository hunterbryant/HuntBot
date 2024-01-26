// Code generated by Slice Machine. DO NOT EDIT.

import type * as prismic from '@prismicio/client';

type Simplify<T> = { [KeyType in keyof T]: T[KeyType] };

/**
 * Content for Affiliation documents
 */
interface AffiliationDocumentData {
	/**
	 * Title field in *Affiliation*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: affiliation.title
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	title: prismic.KeyTextField;

	/**
	 * Link field in *Affiliation*
	 *
	 * - **Field Type**: Link
	 * - **Placeholder**: *None*
	 * - **API ID Path**: affiliation.link
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#link-content-relationship
	 */
	link: prismic.LinkField;

	/**
	 * logo field in *Affiliation*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: affiliation.logo
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#image
	 */
	logo: prismic.ImageField<never>;

	/**
	 * Verbose Title field in *Affiliation*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: affiliation.verbose_title
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	verbose_title: prismic.KeyTextField;
}

/**
 * Affiliation document from Prismic
 *
 * - **API ID**: `affiliation`
 * - **Repeatable**: `true`
 * - **Documentation**: https://prismic.io/docs/custom-types
 *
 * @typeParam Lang - Language API ID of the document.
 */
export type AffiliationDocument<Lang extends string = string> = prismic.PrismicDocumentWithUID<
	Simplify<AffiliationDocumentData>,
	'affiliation',
	Lang
>;

/**
 * Item in *Case Study → Responsibilities*
 */
export interface CaseStudyDocumentDataResponsibilitiesItem {
	/**
	 * Skill field in *Case Study → Responsibilities*
	 *
	 * - **Field Type**: Select
	 * - **Placeholder**: *None*
	 * - **API ID Path**: case_study.responsibilities[].skill
	 * - **Documentation**: https://prismic.io/docs/field#select
	 */
	skill: prismic.SelectField<'UI' | 'UX' | 'Research' | 'Strategy' | 'Data Viz'>;
}

type CaseStudyDocumentDataSlicesSlice = EmbedBlockSlice | ImageBlockSlice | TextBlockSlice;

/**
 * Content for Case Study documents
 */
interface CaseStudyDocumentData {
	/**
	 * Title field in *Case Study*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: case_study.title
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	title: prismic.KeyTextField;

	/**
	 * protected field in *Case Study*
	 *
	 * - **Field Type**: Boolean
	 * - **Placeholder**: *None*
	 * - **Default Value**: false
	 * - **API ID Path**: case_study.protected
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#boolean
	 */
	protected: prismic.BooleanField;

	/**
	 * Hightlight Image field in *Case Study*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: case_study.hightlight_image
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#image
	 */
	hightlight_image: prismic.ImageField<never>;

	/**
	 * Image Fill field in *Case Study*
	 *
	 * - **Field Type**: Boolean
	 * - **Placeholder**: *None*
	 * - **Default Value**: false
	 * - **API ID Path**: case_study.image_fill
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#boolean
	 */
	image_fill: prismic.BooleanField;

	/**
	 * Date field in *Case Study*
	 *
	 * - **Field Type**: Date
	 * - **Placeholder**: *None*
	 * - **API ID Path**: case_study.date
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#date
	 */
	date: prismic.DateField;

	/**
	 * Affiliation field in *Case Study*
	 *
	 * - **Field Type**: Content Relationship
	 * - **Placeholder**: *None*
	 * - **API ID Path**: case_study.affiliation
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#link-content-relationship
	 */
	affiliation: prismic.ContentRelationshipField<'affiliation'>;

	/**
	 * Responsibilities field in *Case Study*
	 *
	 * - **Field Type**: Group
	 * - **Placeholder**: *None*
	 * - **API ID Path**: case_study.responsibilities[]
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#group
	 */
	responsibilities: prismic.GroupField<Simplify<CaseStudyDocumentDataResponsibilitiesItem>>;

	/**
	 * Slice Zone field in *Case Study*
	 *
	 * - **Field Type**: Slice Zone
	 * - **Placeholder**: *None*
	 * - **API ID Path**: case_study.slices[]
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#slices
	 */
	slices: prismic.SliceZone<CaseStudyDocumentDataSlicesSlice> /**
	 * Meta Description field in *Case Study*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: A brief summary of the page
	 * - **API ID Path**: case_study.meta_description
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */;
	meta_description: prismic.KeyTextField;

	/**
	 * Meta Image field in *Case Study*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: case_study.meta_image
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#image
	 */
	meta_image: prismic.ImageField<never>;

	/**
	 * Meta Title field in *Case Study*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: A title of the page used for social media and search engines
	 * - **API ID Path**: case_study.meta_title
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	meta_title: prismic.KeyTextField;
}

/**
 * Case Study document from Prismic
 *
 * - **API ID**: `case_study`
 * - **Repeatable**: `true`
 * - **Documentation**: https://prismic.io/docs/custom-types
 *
 * @typeParam Lang - Language API ID of the document.
 */
export type CaseStudyDocument<Lang extends string = string> = prismic.PrismicDocumentWithUID<
	Simplify<CaseStudyDocumentData>,
	'case_study',
	Lang
>;

type HomeDocumentDataSlicesSlice = ContentHighlightSlice;

/**
 * Content for Home documents
 */
interface HomeDocumentData {
	/**
	 * Landing Image field in *Home*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: home.landing_image
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#image
	 */
	landing_image: prismic.ImageField<never>;

	/**
	 * Slice Zone field in *Home*
	 *
	 * - **Field Type**: Slice Zone
	 * - **Placeholder**: *None*
	 * - **API ID Path**: home.slices[]
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#slices
	 */
	slices: prismic.SliceZone<HomeDocumentDataSlicesSlice> /**
	 * Meta Description field in *Home*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: A brief summary of the page
	 * - **API ID Path**: home.meta_description
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */;
	meta_description: prismic.KeyTextField;

	/**
	 * Meta Image field in *Home*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: home.meta_image
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#image
	 */
	meta_image: prismic.ImageField<never>;

	/**
	 * Meta Title field in *Home*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: A title of the page used for social media and search engines
	 * - **API ID Path**: home.meta_title
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	meta_title: prismic.KeyTextField;
}

/**
 * Home document from Prismic
 *
 * - **API ID**: `home`
 * - **Repeatable**: `false`
 * - **Documentation**: https://prismic.io/docs/custom-types
 *
 * @typeParam Lang - Language API ID of the document.
 */
export type HomeDocument<Lang extends string = string> = prismic.PrismicDocumentWithoutUID<
	Simplify<HomeDocumentData>,
	'home',
	Lang
>;

type InformationDocumentDataSlicesSlice =
	| RecognitionSlice
	| ExperienceSlice
	| ExpertiseSlice
	| InfoEducationImageSlice;

/**
 * Content for Info documents
 */
interface InformationDocumentData {
	/**
	 * header field in *Info*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: information.header
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	header: prismic.KeyTextField;

	/**
	 * Slice Zone field in *Info*
	 *
	 * - **Field Type**: Slice Zone
	 * - **Placeholder**: *None*
	 * - **API ID Path**: information.slices[]
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#slices
	 */
	slices: prismic.SliceZone<InformationDocumentDataSlicesSlice> /**
	 * Meta Description field in *Info*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: A brief summary of the page
	 * - **API ID Path**: information.meta_description
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */;
	meta_description: prismic.KeyTextField;

	/**
	 * Meta Image field in *Info*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: information.meta_image
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#image
	 */
	meta_image: prismic.ImageField<never>;

	/**
	 * Meta Title field in *Info*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: A title of the page used for social media and search engines
	 * - **API ID Path**: information.meta_title
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	meta_title: prismic.KeyTextField;
}

/**
 * Info document from Prismic
 *
 * - **API ID**: `information`
 * - **Repeatable**: `false`
 * - **Documentation**: https://prismic.io/docs/custom-types
 *
 * @typeParam Lang - Language API ID of the document.
 */
export type InformationDocument<Lang extends string = string> = prismic.PrismicDocumentWithoutUID<
	Simplify<InformationDocumentData>,
	'information',
	Lang
>;

type OtherProjectsDocumentDataSlicesSlice = GridGapSlice | ProjectLinkSlice;

/**
 * Content for Other Projects documents
 */
interface OtherProjectsDocumentData {
	/**
	 * Header field in *Other Projects*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: other_projects.header
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	header: prismic.KeyTextField;

	/**
	 * Slice Zone field in *Other Projects*
	 *
	 * - **Field Type**: Slice Zone
	 * - **Placeholder**: *None*
	 * - **API ID Path**: other_projects.slices[]
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#slices
	 */
	slices: prismic.SliceZone<OtherProjectsDocumentDataSlicesSlice> /**
	 * Meta Description field in *Other Projects*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: A brief summary of the page
	 * - **API ID Path**: other_projects.meta_description
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */;
	meta_description: prismic.KeyTextField;

	/**
	 * Meta Image field in *Other Projects*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: other_projects.meta_image
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#image
	 */
	meta_image: prismic.ImageField<never>;

	/**
	 * Meta Title field in *Other Projects*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: A title of the page used for social media and search engines
	 * - **API ID Path**: other_projects.meta_title
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	meta_title: prismic.KeyTextField;
}

/**
 * Other Projects document from Prismic
 *
 * - **API ID**: `other_projects`
 * - **Repeatable**: `false`
 * - **Documentation**: https://prismic.io/docs/custom-types
 *
 * @typeParam Lang - Language API ID of the document.
 */
export type OtherProjectsDocument<Lang extends string = string> = prismic.PrismicDocumentWithoutUID<
	Simplify<OtherProjectsDocumentData>,
	'other_projects',
	Lang
>;

type ProjectDocumentDataSlicesSlice = TextBlockSlice | EmbedBlockSlice | ImageBlockSlice;

/**
 * Content for Project documents
 */
interface ProjectDocumentData {
	/**
	 * Title field in *Project*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: project.title
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	title: prismic.KeyTextField;

	/**
	 * Highlight Image field in *Project*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: project.highlight_image
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#image
	 */
	highlight_image: prismic.ImageField<never>;

	/**
	 * Image Fill field in *Project*
	 *
	 * - **Field Type**: Boolean
	 * - **Placeholder**: *None*
	 * - **Default Value**: false
	 * - **API ID Path**: project.image_fill
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#boolean
	 */
	image_fill: prismic.BooleanField;

	/**
	 * Project Type field in *Project*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: project.project_type
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	project_type: prismic.KeyTextField;

	/**
	 * Slice Zone field in *Project*
	 *
	 * - **Field Type**: Slice Zone
	 * - **Placeholder**: *None*
	 * - **API ID Path**: project.slices[]
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#slices
	 */
	slices: prismic.SliceZone<ProjectDocumentDataSlicesSlice>;

	/**
	 * BG COlor field in *Project*
	 *
	 * - **Field Type**: Color
	 * - **Placeholder**: *None*
	 * - **API ID Path**: project.bg_color
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/field#color
	 */
	bg_color: prismic.ColorField /**
	 * Meta Description field in *Project*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: A brief summary of the page
	 * - **API ID Path**: project.meta_description
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */;
	meta_description: prismic.KeyTextField;

	/**
	 * Meta Image field in *Project*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: project.meta_image
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#image
	 */
	meta_image: prismic.ImageField<never>;

	/**
	 * Meta Title field in *Project*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: A title of the page used for social media and search engines
	 * - **API ID Path**: project.meta_title
	 * - **Tab**: SEO & Metadata
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	meta_title: prismic.KeyTextField;
}

/**
 * Project document from Prismic
 *
 * - **API ID**: `project`
 * - **Repeatable**: `true`
 * - **Documentation**: https://prismic.io/docs/custom-types
 *
 * @typeParam Lang - Language API ID of the document.
 */
export type ProjectDocument<Lang extends string = string> = prismic.PrismicDocumentWithUID<
	Simplify<ProjectDocumentData>,
	'project',
	Lang
>;

export type AllDocumentTypes =
	| AffiliationDocument
	| CaseStudyDocument
	| HomeDocument
	| InformationDocument
	| OtherProjectsDocument
	| ProjectDocument;

/**
 * Primary content in *ContentHighlight → Primary*
 */
export interface ContentHighlightSliceDefaultPrimary {
	/**
	 * Project field in *ContentHighlight → Primary*
	 *
	 * - **Field Type**: Content Relationship
	 * - **Placeholder**: *None*
	 * - **API ID Path**: content_highlight.primary.project
	 * - **Documentation**: https://prismic.io/docs/field#link-content-relationship
	 */
	project: prismic.ContentRelationshipField<'case_study'>;
}

/**
 * Default variation for ContentHighlight Slice
 *
 * - **API ID**: `default`
 * - **Description**: Default
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type ContentHighlightSliceDefault = prismic.SharedSliceVariation<
	'default',
	Simplify<ContentHighlightSliceDefaultPrimary>,
	never
>;

/**
 * Primary content in *ContentHighlight → Primary*
 */
export interface ContentHighlightSlice3DModelPrimary {
	/**
	 * Project field in *ContentHighlight → Primary*
	 *
	 * - **Field Type**: Content Relationship
	 * - **Placeholder**: *None*
	 * - **API ID Path**: content_highlight.primary.project
	 * - **Documentation**: https://prismic.io/docs/field#link-content-relationship
	 */
	project: prismic.ContentRelationshipField<'case_study'>;

	/**
	 * model field in *ContentHighlight → Primary*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: content_highlight.primary.model
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	model: prismic.KeyTextField;
}

/**
 * 3D Model variation for ContentHighlight Slice
 *
 * - **API ID**: `3DModel`
 * - **Description**: Default
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type ContentHighlightSlice3DModel = prismic.SharedSliceVariation<
	'3DModel',
	Simplify<ContentHighlightSlice3DModelPrimary>,
	never
>;

/**
 * Slice variation for *ContentHighlight*
 */
type ContentHighlightSliceVariation = ContentHighlightSliceDefault | ContentHighlightSlice3DModel;

/**
 * ContentHighlight Shared Slice
 *
 * - **API ID**: `content_highlight`
 * - **Description**: ContentHighlight
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type ContentHighlightSlice = prismic.SharedSlice<
	'content_highlight',
	ContentHighlightSliceVariation
>;

/**
 * Primary content in *EmbedBlock → Primary*
 */
export interface EmbedBlockSliceDefaultPrimary {
	/**
	 * embed field in *EmbedBlock → Primary*
	 *
	 * - **Field Type**: Embed
	 * - **Placeholder**: *None*
	 * - **API ID Path**: embed_block.primary.embed
	 * - **Documentation**: https://prismic.io/docs/field#embed
	 */
	embed: prismic.EmbedField;
}

/**
 * Default variation for EmbedBlock Slice
 *
 * - **API ID**: `default`
 * - **Description**: Default
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type EmbedBlockSliceDefault = prismic.SharedSliceVariation<
	'default',
	Simplify<EmbedBlockSliceDefaultPrimary>,
	never
>;

/**
 * Slice variation for *EmbedBlock*
 */
type EmbedBlockSliceVariation = EmbedBlockSliceDefault;

/**
 * EmbedBlock Shared Slice
 *
 * - **API ID**: `embed_block`
 * - **Description**: EmbedBlock
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type EmbedBlockSlice = prismic.SharedSlice<'embed_block', EmbedBlockSliceVariation>;

/**
 * Primary content in *Experience → Items*
 */
export interface ExperienceSliceDefaultItem {
	/**
	 * Title field in *Experience → Items*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: experience.items[].title
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	title: prismic.KeyTextField;

	/**
	 * Affiliation field in *Experience → Items*
	 *
	 * - **Field Type**: Content Relationship
	 * - **Placeholder**: *None*
	 * - **API ID Path**: experience.items[].affiliation
	 * - **Documentation**: https://prismic.io/docs/field#link-content-relationship
	 */
	affiliation: prismic.ContentRelationshipField<'affiliation'>;

	/**
	 * Timeframe field in *Experience → Items*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: experience.items[].timeframe
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	timeframe: prismic.KeyTextField;

	/**
	 * Caption field in *Experience → Items*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: experience.items[].caption
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	caption: prismic.KeyTextField;

	/**
	 * Body field in *Experience → Items*
	 *
	 * - **Field Type**: Rich Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: experience.items[].body
	 * - **Documentation**: https://prismic.io/docs/field#rich-text-title
	 */
	body: prismic.RichTextField;
}

/**
 * Default variation for Experience Slice
 *
 * - **API ID**: `default`
 * - **Description**: Default
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type ExperienceSliceDefault = prismic.SharedSliceVariation<
	'default',
	Record<string, never>,
	Simplify<ExperienceSliceDefaultItem>
>;

/**
 * Slice variation for *Experience*
 */
type ExperienceSliceVariation = ExperienceSliceDefault;

/**
 * Experience Shared Slice
 *
 * - **API ID**: `experience`
 * - **Description**: Experience
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type ExperienceSlice = prismic.SharedSlice<'experience', ExperienceSliceVariation>;

/**
 * Primary content in *Expertise → Items*
 */
export interface ExpertiseSliceDefaultItem {
	/**
	 * skill name field in *Expertise → Items*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: expertise.items[].skill_name
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	skill_name: prismic.KeyTextField;

	/**
	 * skill decription field in *Expertise → Items*
	 *
	 * - **Field Type**: Rich Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: expertise.items[].skill_decription
	 * - **Documentation**: https://prismic.io/docs/field#rich-text-title
	 */
	skill_decription: prismic.RichTextField;

	/**
	 * skill tags field in *Expertise → Items*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: expertise.items[].skill_tags
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	skill_tags: prismic.KeyTextField;
}

/**
 * Default variation for Expertise Slice
 *
 * - **API ID**: `default`
 * - **Description**: Default
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type ExpertiseSliceDefault = prismic.SharedSliceVariation<
	'default',
	Record<string, never>,
	Simplify<ExpertiseSliceDefaultItem>
>;

/**
 * Slice variation for *Expertise*
 */
type ExpertiseSliceVariation = ExpertiseSliceDefault;

/**
 * Expertise Shared Slice
 *
 * - **API ID**: `expertise`
 * - **Description**: Expertise
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type ExpertiseSlice = prismic.SharedSlice<'expertise', ExpertiseSliceVariation>;

/**
 * Default variation for GridGap Slice
 *
 * - **API ID**: `default`
 * - **Description**: Default
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type GridGapSliceDefault = prismic.SharedSliceVariation<
	'default',
	Record<string, never>,
	never
>;

/**
 * Slice variation for *GridGap*
 */
type GridGapSliceVariation = GridGapSliceDefault;

/**
 * GridGap Shared Slice
 *
 * - **API ID**: `grid_gap`
 * - **Description**: GridGap
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type GridGapSlice = prismic.SharedSlice<'grid_gap', GridGapSliceVariation>;

/**
 * Primary content in *ImageBlock → Primary*
 */
export interface ImageBlockSliceDefaultPrimary {
	/**
	 * image field in *ImageBlock → Primary*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: image_block.primary.image
	 * - **Documentation**: https://prismic.io/docs/field#image
	 */
	image: prismic.ImageField<never>;

	/**
	 * caption field in *ImageBlock → Primary*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: image_block.primary.caption
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	caption: prismic.KeyTextField;
}

/**
 * Default variation for ImageBlock Slice
 *
 * - **API ID**: `default`
 * - **Description**: Default
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type ImageBlockSliceDefault = prismic.SharedSliceVariation<
	'default',
	Simplify<ImageBlockSliceDefaultPrimary>,
	never
>;

/**
 * Primary content in *ImageBlock → Items*
 */
export interface ImageBlockSliceCarouselItem {
	/**
	 * image field in *ImageBlock → Items*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: image_block.items[].image
	 * - **Documentation**: https://prismic.io/docs/field#image
	 */
	image: prismic.ImageField<never>;

	/**
	 * caption field in *ImageBlock → Items*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: image_block.items[].caption
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	caption: prismic.KeyTextField;
}

/**
 * Carousel variation for ImageBlock Slice
 *
 * - **API ID**: `carousel`
 * - **Description**: Default
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type ImageBlockSliceCarousel = prismic.SharedSliceVariation<
	'carousel',
	Record<string, never>,
	Simplify<ImageBlockSliceCarouselItem>
>;

/**
 * Slice variation for *ImageBlock*
 */
type ImageBlockSliceVariation = ImageBlockSliceDefault | ImageBlockSliceCarousel;

/**
 * ImageBlock Shared Slice
 *
 * - **API ID**: `image_block`
 * - **Description**: ImageBlock
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type ImageBlockSlice = prismic.SharedSlice<'image_block', ImageBlockSliceVariation>;

/**
 * Primary content in *InfoEducationImage → Primary*
 */
export interface InfoEducationImageSliceDefaultPrimary {
	/**
	 * body field in *InfoEducationImage → Primary*
	 *
	 * - **Field Type**: Rich Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: info_education_image.primary.body
	 * - **Documentation**: https://prismic.io/docs/field#rich-text-title
	 */
	body: prismic.RichTextField;

	/**
	 * image field in *InfoEducationImage → Primary*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: info_education_image.primary.image
	 * - **Documentation**: https://prismic.io/docs/field#image
	 */
	image: prismic.ImageField<never>;

	/**
	 * education field in *InfoEducationImage → Primary*
	 *
	 * - **Field Type**: Rich Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: info_education_image.primary.education
	 * - **Documentation**: https://prismic.io/docs/field#rich-text-title
	 */
	education: prismic.RichTextField;
}

/**
 * Default variation for InfoEducationImage Slice
 *
 * - **API ID**: `default`
 * - **Description**: Default
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type InfoEducationImageSliceDefault = prismic.SharedSliceVariation<
	'default',
	Simplify<InfoEducationImageSliceDefaultPrimary>,
	never
>;

/**
 * Slice variation for *InfoEducationImage*
 */
type InfoEducationImageSliceVariation = InfoEducationImageSliceDefault;

/**
 * InfoEducationImage Shared Slice
 *
 * - **API ID**: `info_education_image`
 * - **Description**: InfoEducationImage
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type InfoEducationImageSlice = prismic.SharedSlice<
	'info_education_image',
	InfoEducationImageSliceVariation
>;

/**
 * Primary content in *ProjectLink → Primary*
 */
export interface ProjectLinkSliceDefaultPrimary {
	/**
	 * project field in *ProjectLink → Primary*
	 *
	 * - **Field Type**: Content Relationship
	 * - **Placeholder**: *None*
	 * - **API ID Path**: project_link.primary.project
	 * - **Documentation**: https://prismic.io/docs/field#link-content-relationship
	 */
	project: prismic.ContentRelationshipField<'project'>;
}

/**
 * Default variation for ProjectLink Slice
 *
 * - **API ID**: `default`
 * - **Description**: Default
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type ProjectLinkSliceDefault = prismic.SharedSliceVariation<
	'default',
	Simplify<ProjectLinkSliceDefaultPrimary>,
	never
>;

/**
 * Slice variation for *ProjectLink*
 */
type ProjectLinkSliceVariation = ProjectLinkSliceDefault;

/**
 * ProjectLink Shared Slice
 *
 * - **API ID**: `project_link`
 * - **Description**: ProjectLink
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type ProjectLinkSlice = prismic.SharedSlice<'project_link', ProjectLinkSliceVariation>;

/**
 * Primary content in *Recognition → Items*
 */
export interface RecognitionSliceDefaultItem {
	/**
	 * title field in *Recognition → Items*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: recognition.items[].title
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	title: prismic.KeyTextField;

	/**
	 * year field in *Recognition → Items*
	 *
	 * - **Field Type**: Number
	 * - **Placeholder**: *None*
	 * - **API ID Path**: recognition.items[].year
	 * - **Documentation**: https://prismic.io/docs/field#number
	 */
	year: prismic.NumberField;

	/**
	 * description field in *Recognition → Items*
	 *
	 * - **Field Type**: Rich Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: recognition.items[].description
	 * - **Documentation**: https://prismic.io/docs/field#rich-text-title
	 */
	description: prismic.RichTextField;

	/**
	 * link url field in *Recognition → Items*
	 *
	 * - **Field Type**: Link
	 * - **Placeholder**: *None*
	 * - **API ID Path**: recognition.items[].link_url
	 * - **Documentation**: https://prismic.io/docs/field#link-content-relationship
	 */
	link_url: prismic.LinkField;

	/**
	 * link label field in *Recognition → Items*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: recognition.items[].link_label
	 * - **Documentation**: https://prismic.io/docs/field#key-text
	 */
	link_label: prismic.KeyTextField;
}

/**
 * Default variation for Recognition Slice
 *
 * - **API ID**: `default`
 * - **Description**: Default
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type RecognitionSliceDefault = prismic.SharedSliceVariation<
	'default',
	Record<string, never>,
	Simplify<RecognitionSliceDefaultItem>
>;

/**
 * Slice variation for *Recognition*
 */
type RecognitionSliceVariation = RecognitionSliceDefault;

/**
 * Recognition Shared Slice
 *
 * - **API ID**: `recognition`
 * - **Description**: Recognition
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type RecognitionSlice = prismic.SharedSlice<'recognition', RecognitionSliceVariation>;

/**
 * Primary content in *TextBlock → Primary*
 */
export interface TextBlockSliceDefaultPrimary {
	/**
	 * content field in *TextBlock → Primary*
	 *
	 * - **Field Type**: Rich Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: text_block.primary.content
	 * - **Documentation**: https://prismic.io/docs/field#rich-text-title
	 */
	content: prismic.RichTextField;
}

/**
 * Default variation for TextBlock Slice
 *
 * - **API ID**: `default`
 * - **Description**: Default
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type TextBlockSliceDefault = prismic.SharedSliceVariation<
	'default',
	Simplify<TextBlockSliceDefaultPrimary>,
	never
>;

/**
 * Slice variation for *TextBlock*
 */
type TextBlockSliceVariation = TextBlockSliceDefault;

/**
 * TextBlock Shared Slice
 *
 * - **API ID**: `text_block`
 * - **Description**: TextBlock
 * - **Documentation**: https://prismic.io/docs/slice
 */
export type TextBlockSlice = prismic.SharedSlice<'text_block', TextBlockSliceVariation>;

declare module '@prismicio/client' {
	interface CreateClient {
		(
			repositoryNameOrEndpoint: string,
			options?: prismic.ClientConfig
		): prismic.Client<AllDocumentTypes>;
	}

	namespace Content {
		export type {
			AffiliationDocument,
			AffiliationDocumentData,
			CaseStudyDocument,
			CaseStudyDocumentData,
			CaseStudyDocumentDataResponsibilitiesItem,
			CaseStudyDocumentDataSlicesSlice,
			HomeDocument,
			HomeDocumentData,
			HomeDocumentDataSlicesSlice,
			InformationDocument,
			InformationDocumentData,
			InformationDocumentDataSlicesSlice,
			OtherProjectsDocument,
			OtherProjectsDocumentData,
			OtherProjectsDocumentDataSlicesSlice,
			ProjectDocument,
			ProjectDocumentData,
			ProjectDocumentDataSlicesSlice,
			AllDocumentTypes,
			ContentHighlightSlice,
			ContentHighlightSliceDefaultPrimary,
			ContentHighlightSlice3DModelPrimary,
			ContentHighlightSliceVariation,
			ContentHighlightSliceDefault,
			ContentHighlightSlice3DModel,
			EmbedBlockSlice,
			EmbedBlockSliceDefaultPrimary,
			EmbedBlockSliceVariation,
			EmbedBlockSliceDefault,
			ExperienceSlice,
			ExperienceSliceDefaultItem,
			ExperienceSliceVariation,
			ExperienceSliceDefault,
			ExpertiseSlice,
			ExpertiseSliceDefaultItem,
			ExpertiseSliceVariation,
			ExpertiseSliceDefault,
			GridGapSlice,
			GridGapSliceVariation,
			GridGapSliceDefault,
			ImageBlockSlice,
			ImageBlockSliceDefaultPrimary,
			ImageBlockSliceCarouselItem,
			ImageBlockSliceVariation,
			ImageBlockSliceDefault,
			ImageBlockSliceCarousel,
			InfoEducationImageSlice,
			InfoEducationImageSliceDefaultPrimary,
			InfoEducationImageSliceVariation,
			InfoEducationImageSliceDefault,
			ProjectLinkSlice,
			ProjectLinkSliceDefaultPrimary,
			ProjectLinkSliceVariation,
			ProjectLinkSliceDefault,
			RecognitionSlice,
			RecognitionSliceDefaultItem,
			RecognitionSliceVariation,
			RecognitionSliceDefault,
			TextBlockSlice,
			TextBlockSliceDefaultPrimary,
			TextBlockSliceVariation,
			TextBlockSliceDefault
		};
	}
}
