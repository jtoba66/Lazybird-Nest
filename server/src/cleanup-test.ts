import obsideoProvider from './storage/obsideoProvider';

async function run() {
    // The key generated during the test
    const objectKey = 'test_uploads/speed_test_1780239725457';
    
    console.log(`Deleting ${objectKey} from Obsideo...`);
    const success = await obsideoProvider.delete(objectKey);
    
    if (success) {
        console.log('✅ File successfully deleted from Obsideo network.');
    } else {
        console.log('❌ Failed to delete file from Obsideo network.');
    }
}

run().catch(console.error);
