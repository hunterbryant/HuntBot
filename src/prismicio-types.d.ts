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

type CaseStudyDocumentDataSlicesSlice = ContentHighlightSlice;

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

type InformationDocumentDataSlicesSlice = ExpertiseSlice | InfoEducationImageSlice;

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

export type AllDocumentTypes =
	| AffiliationDocument
	| CaseStudyDocument
	| HomeDocument
	| InformationDocument;

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
			AllDocumentTypes,
			ContentHighlightSlice,
			ContentHighlightSliceDefaultPrimary,
			ContentHighlightSlice3DModelPrimary,
			ContentHighlightSliceVariation,
			ContentHighlightSliceDefault,
			ContentHighlightSlice3DModel,
			ExpertiseSlice,
			ExpertiseSliceDefaultItem,
			ExpertiseSliceVariation,
			ExpertiseSliceDefault,
			InfoEducationImageSlice,
			InfoEducationImageSliceDefaultPrimary,
			InfoEducationImageSliceVariation,
			InfoEducationImageSliceDefault
		};
	}
}
