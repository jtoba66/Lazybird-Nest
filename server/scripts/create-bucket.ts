import { ObsideoClient, FilesystemBundleStore } from '@obsideo/sdk';

async function main() {
    const bundleStore = new FilesystemBundleStore('/app/uploads/obsideo-bundle');
    const client = new ObsideoClient({
        coordinatorUrl: process.env.OBSIDEO_COORDINATOR_URL!,
        coordinatorPublicKey: process.env.OBSIDEO_COORDINATOR_PUBLIC_KEY!,
        apiKey: process.env.OBSIDEO_API_KEY!,
        encryptionMode: 'external',
        customerId: process.env.OBSIDEO_ACCOUNT_ID!,
        customerPublicKey: process.env.OBSIDEO_CUSTOMER_PUBLIC_KEY!,
        customerPrivateKey: process.env.OBSIDEO_CUSTOMER_PRIVATE_KEY!,
        bundleStore
    });

    console.log('Creating bucket lazybird-storage...');
    await client.createBucket('lazybird-storage');
    console.log('Bucket created successfully!');
}

main().catch(console.error);
