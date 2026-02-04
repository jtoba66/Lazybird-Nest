import { Helmet } from 'react-helmet-async';

interface SEOProps {
    title?: string;
    description?: string;
    canonical?: string;
    type?: string;
    name?: string;
    image?: string;
    jsonLd?: Record<string, any>[];
}

const SEO = ({
    title,
    description,
    canonical,
    type = 'website',
    name = 'Nest',
    image = '/og-image.png',
    jsonLd
}: SEOProps) => {
    const siteTitle = 'Nest | Secure Cloud Storage & Private File Sharing';
    const siteDescription = 'LazyBird Nest is your secure, zero-knowledge cloud vault. Store and share your files with military-grade encryption. Only you hold the keys.';

    return (
        <Helmet>
            {/* Standard Metadata */}
            <title>{title ? `${title} | Nest` : siteTitle}</title>
            <meta name="description" content={description || siteDescription} />
            {canonical && <link rel="canonical" href={canonical} />}

            {/* Open Graph / Facebook */}
            <meta property="og:type" content={type} />
            <meta property="og:site_name" content={name} />
            <meta property="og:title" content={title ? `${title} | Nest` : siteTitle} />
            <meta property="og:description" content={description || siteDescription} />
            <meta property="og:image" content={image} />

            {/* Twitter */}
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={title ? `${title} | Nest` : siteTitle} />
            <meta name="twitter:description" content={description || siteDescription} />
            <meta name="twitter:image" content={image} />

            {/* Structured Data (JSON-LD) */}
            {jsonLd && (
                <script type="application/ld+json">
                    {JSON.stringify(jsonLd)}
                </script>
            )}
        </Helmet>
    );
};

export default SEO;
